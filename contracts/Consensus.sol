// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Distribution} from "./libs/Distribution.sol";

import {L2Sender} from "./L2Sender.sol";
import {IConsensus} from "./interfaces/IConsensus.sol";

import "hardhat/console.sol";

contract Consensus is IConsensus, OwnableUpgradeable, UUPSUpgradeable {
    bool public isNotUpgradeable;

    address public l2Sender;

    uint256 public rewardStart;
    uint256 public maxSupply;

    uint256 public constant VALIDATOR_PERCENTAGE = 20;

    mapping(bytes32 => address) public peers;
    mapping(address => uint256) public peerBalances;
    mapping(address => bool) public validators;
    mapping(address => uint256) public validatorBalances;

    uint256 public lastUpdate;
    address[] internal acceptedValidators;

    constructor() {
        _disableInitializers();
    }

    function Consensus_init(address l2Sender_, uint256 rewardStart_, uint256 maxSupply_) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        l2Sender = l2Sender_;
        rewardStart = rewardStart_;
        maxSupply = maxSupply_;
    }

    /**
     * @dev Sets the L2 sender address.
     * @param l2Sender_ The address of the L2 sender.
     */
    function setL2Sender(address l2Sender_) external onlyOwner {
        l2Sender = l2Sender_;
    }

    /**
     * @dev Set validator state
     * @param account The validator's address.
     * @param state The validator's state.
     */
    function setValidator(address account, bool state) external onlyOwner {
        validators[account] = state;
    }

    /**
     * @dev Registers a peer with the given peer ID and account address.
     * @param peerId The unique identifier of the peer.
     * @param account The Ethereum address associated with the peer.
     */
    function registerPeer(bytes32 peerId, address account) public {
        peers[peerId] = account;
        emit PeerRegistered(peerId, account);
    }

    /**
     * @dev Validates the network state by checking the consensus among validators.
     * @param peerIds The array of peer IDs.
     * @param throughputs The array of throughputs corresponding to each peer.
     * @param layers The array of layers corresponding to each peer.
     * @param total The total value used for calculating balances.
     * @param signatures The array of signatures provided by validators.
     * @param validators_ The array of validator addresses.
     * Requirements:
     * - The lengths of `peerIds`, `throughputs`, and `layers` arrays must be equal.
     * - The length of `signatures` array must be equal to the length of `validators` array.
     * - At least 66% consensus must be reached among validators.
     * - If consensus is reached, balances are updated according to throughputs.
     */
    function validateNetworkState(
        bytes32[] calldata peerIds,
        uint256[] calldata throughputs,
        uint256[] calldata layers,
        uint256 total,
        bytes[] calldata signatures,
        address[] calldata validators_
    ) public {
        require(peerIds.length == throughputs.length && throughputs.length == layers.length, "Data length mismatch");
        require(signatures.length == validators_.length, "Signature count mismatch");

        address[] storage _acceptedValidators = acceptedValidators;
        uint256 totalValidators = 0;
        bytes32 dataHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(peerIds, throughputs, layers, total))
            )
        );

        for (uint256 i = 0; i < signatures.length; i++) {
            if (!validators[validators_[i]]) {
                continue;
            }
            totalValidators++;
            if (ECDSA.recover(dataHash, signatures[i]) == validators_[i]) {
                _acceptedValidators.push(validators_[i]);
            }
        }

        require(totalValidators > 0, "No validators");

        // Ensure at least 66% consensus
        require((_acceptedValidators.length * 100) / totalValidators >= 66, "Consensus not reached");

        console.log("rewardStart: %d", rewardStart);

        // period reward
        uint256 periodReward = Distribution.calculateAccumulatedDistribution(
            maxSupply,
            rewardStart,
            lastUpdate,
            block.timestamp
        );

        console.log("periodReward: %d", periodReward);

        // update last update
        lastUpdate = block.timestamp;

        uint256 peersReward = periodReward * (100 - VALIDATOR_PERCENTAGE) / 100;

        console.log("peersReward: %d", peersReward);

        // Distributes rewards to peers based on their contribution.
        for (uint256 i = 0; i < peerIds.length; i++) {
            bytes32 peerId = peerIds[i];
            address peer = peers[peerId];
            // calculate contribution
            uint256 throughput = throughputs[i];
            uint256 layer = layers[i];
            uint256 contribution = throughput * layer;
            if (peer == address(0)) {
                // peer not registered
                total -= contribution;
                continue;
            }
            // update balance
            uint256 balance = (contribution * peersReward) / total;
            // update peer balance
            peerBalances[peer] += balance;

            console.log("peer %d balance %d", peer, balance);
            console.log("throughput %d layers %d", throughput, layer);
            // emit event
            emit BalancesUpdated(peer, balance);
        }

        // Distributes rewards to validators based on their contribution.
        uint256 validatorsReward = periodReward - peersReward;
        console.log("validatorsReward: %d", validatorsReward);
        uint256 validatorReward = validatorsReward / _acceptedValidators.length;
        for (uint256 i = 0; i < _acceptedValidators.length; i++) {
            address validator = _acceptedValidators[i];
            validatorBalances[validator] += validatorReward;
            console.log("validator %d balance: %d", validator, validatorReward);
            // emit event
            emit BalancesUpdated(validator, validatorReward);
        }
    }

    /**
     * @dev Allows a user to claim their pending rewards.
     * @param receiver_ The address where the rewards will be sent.
     */
    function claim(address receiver_) external payable {
        address user_ = _msgSender();

        require(block.timestamp > rewardStart, "CNS: rewards not started yet");

        uint256 pendingPeerRewards_ = peerBalances[user_];
        uint256 pendingValidatorRewards_ = validatorBalances[user_];
        require(pendingPeerRewards_ > 0 || pendingValidatorRewards_ > 0, "CNS: nothing to claim");

        // Update user data
        peerBalances[user_] = 0;
        validatorBalances[user_] = 0;

        uint256 pendingRewards_ = pendingPeerRewards_ + pendingValidatorRewards_;
        
        // mint rewards
        L2Sender(l2Sender).sendMintMessage{value: msg.value}(receiver_, pendingRewards_, user_);

        emit UserClaimed(user_, receiver_, pendingRewards_);
    }

    function generatePeerId(string calldata peerId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(peerId));
    }

    /**********************************************************************************************/
    /*** UUPS                                                                                   ***/
    /**********************************************************************************************/

    function removeUpgradeability() external onlyOwner {
        isNotUpgradeable = true;
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        require(!isNotUpgradeable, "CNS: upgrade isn't available");
    }

    /* function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function withdrawAll() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function withdrawERC20(address tokenAddress) public onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(owner(), token.balanceOf(address(this)));
    } */

    function testSignature(
        bytes32[] calldata peerIds,
        uint256[] calldata throughputs,
        uint256[] calldata layers,
        uint256 total,
        bytes calldata signature,
        address account
    ) public pure returns (address) {
        bytes32 dataHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(peerIds, throughputs, layers, total))
            )
        );

        console.logBytes32(dataHash);

        return ECDSA.recover(dataHash, signature);
    }
}
