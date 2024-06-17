// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Distribution} from "./libs/Distribution.sol";

import {L2Sender} from "./L2Sender.sol";
import {IConsensus} from "./interfaces/IConsensus.sol";

/**
 * @title Consensus
 * @dev The Consensus contract is responsible for managing the consensus mechanism of the peerz network.
 */
contract Consensus is IConsensus, OwnableUpgradeable, UUPSUpgradeable {
    bool public isNotUpgradeable;

    address public l2Sender;

    uint256 public rewardStart;
    uint256 public maxSupply;

    uint256 public lastUpdateTime;
    uint256 public rewardPerContributionStored;

    mapping(bytes32 => uint256) public peerRewardPerContributionPaid;
    mapping(bytes32 => uint256) public rewards;

    uint256 public totalContributions;
    mapping(bytes32 => uint256) public contributions;


    uint256 public constant VALIDATOR_PERCENTAGE = 20;

    bytes32[] public activePeers;

    mapping(bytes32 => address) public peers;
    mapping(bytes32 => uint256) public activePeersIndexes;

    mapping(address => bool) public validators;
    mapping(address => uint256) public validatorRewards;

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
     * @dev Returns the reward per contribution.
     */
    function rewardPerContribution() public view returns (uint256) {
        if (totalContributions == 0) {
            return rewardPerContributionStored;
        }
        uint256 totalRewards = Distribution.calculateAccumulatedDistribution(maxSupply, rewardStart, lastUpdateTime, block.timestamp);
        if (totalRewards == 0) {
            return rewardPerContributionStored;
        }
        return rewardPerContributionStored + totalRewards * 1e18 / totalContributions;
    }

    /**
     * @dev Returns the total rewards earned by the peer.
     * @param peerId The unique identifier of the peer.
     */
    function earned(bytes32 peerId) public view returns (uint256) {
        return contributions[peerId] * (rewardPerContribution() - peerRewardPerContributionPaid[peerId]) / 1e18 + rewards[peerId];
    }


    /**
     * @dev Registers a peer with the given peer ID and account address.
     * @param peerId The unique identifier of the peer.
     * @param contribution The contribution of the peer.
     */
    function registerPeer(bytes32 peerId, uint256 contribution) external updateReward(peerId) {
        require(peers[peerId] == address(0), "Peer already registered");
        require(contribution > 0, "Invalid contribution");
        // add peer
        peers[peerId] = msg.sender;
        contributions[peerId] = contribution;
        // add to active peers
        activePeers.push(peerId);
        activePeersIndexes[peerId] = activePeers.length - 1;
        // update total contributions
        totalContributions += contribution;
        // emit event
        emit PeerRegistered(peerId, msg.sender);
    }

    /**
     * @dev Updates the contribution of the peer with the given peer ID.
     * @param peerId The unique identifier of the peer.
     * @param contribution The new contribution of the peer.
     */
    function updatePeerContribution(bytes32 peerId, uint256 contribution) external updateReward(peerId) onlyPeer(peerId) {
        require(contribution > 0, "CNS: invalid contribution");

        totalContributions = totalContributions - contributions[peerId] + contribution;
        contributions[peerId] = contribution;

        emit PeerContributionUpdated(peerId, contribution);
    }

    /**
     * @dev Updates the account address of the peer with the given peer ID.
     * @param peerId The unique identifier of the peer.
     * @param newAddress The new account address of the peer.
     */
    function updatePeerAddress(bytes32 peerId, address newAddress) external updateReward(peerId) onlyPeer(peerId) {
        peers[peerId] = newAddress;

        emit PeerAddressUpdated(peerId, newAddress);
    }

    /**
     * @dev Returns the active peers count and the total contributions.
     * @return activePeersCount The count of active peers.
     * @return totalContributions The total contributions.
     */
    function getActivePeers() external view returns (uint256, uint256) {
        return (activePeers.length, totalContributions);
    }

    /**
     * @dev Returns the active peers under the given index range.
     * @param start The start index of the active peers.
     * @param end The end index of the active peers.
     * @return peerIds The unique identifiers of the active peers.
     * @return contributions The contributions of the active peers.
     */
    function getActivePeersRange(uint256 start, uint256 end) external view returns (bytes32[] memory, uint256[] memory) {
        require(start < activePeers.length, "Invalid start index");
        require(end < activePeers.length, "Invalid end index");
        bytes32[] memory peerIds = new bytes32[](end - start + 1);
        uint256[] memory _contributions = new uint256[](end - start + 1);
        for (uint256 i = start; i <= end; i++) {
            peerIds[i - start] = activePeers[i];
            _contributions[i - start] = contributions[activePeers[i]];
        }
        return (peerIds, _contributions);
    }

    /**
     * @dev Deactivates a peer with the given peer ID.
     * @param peerId The unique identifier of the peer.
     */
    function _deactivatePeer(bytes32 peerId) internal updateReward(peerId) {
        require(peers[peerId] != address(0), "Peer not registered");
        // update total contributions
        totalContributions -= contributions[peerId];
        contributions[peerId] = 0;
        // remove from active peers
        bytes32 lastActivePeerId = activePeers[activePeers.length - 1];
        activePeers[activePeersIndexes[peerId]] = lastActivePeerId;
        activePeersIndexes[lastActivePeerId] = activePeersIndexes[peerId];
        delete activePeersIndexes[peerId];
        activePeers.pop();
        
        emit PeerDeactivated(peerId);
    }

    /**
     * @dev Deactivates a peer with the given peer ID.
     * @param peerId The unique identifier of the peer.
     */
    function deactivatePeer(bytes32 peerId) public onlyPeer(peerId) {
        _deactivatePeer(peerId);
    }

    /**
     * @dev Deactivates a peer with the given peer ID.
     * @param peerId The unique identifier of the peer.
     */
    function reportPeer(
        bytes[] calldata signatures,
        address[] calldata validators_,
        bytes32 peerId
    ) public {
        require(signatures.length == validators_.length, "Signature count mismatch");
        // require peer is active
        require(activePeers.length > activePeersIndexes[peerId], "Peer not active");
        require(peerId == activePeers[activePeersIndexes[peerId]], "Peer not active");

        acceptedValidators = new address[](0);

        address[] storage _acceptedValidators = acceptedValidators;
        uint256 totalValidators = 0;
        bytes32 dataHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(peerId))
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

        // Deactivate peer
        _deactivatePeer(peerId);

        // Distribute rewards
        rewards[peerId] = earned(peerId);

        // slashing
        uint256 validatorsReward = rewards[peerId] * VALIDATOR_PERCENTAGE / 100;
        rewards[peerId] = rewards[peerId] - validatorsReward;

        uint256 validatorReward = validatorsReward / _acceptedValidators.length;
        for (uint256 i = 0; i < _acceptedValidators.length; i++) {
            address validator = _acceptedValidators[i];
            validatorRewards[validator] += validatorReward;
            // emit event
            emit BalancesUpdated(validator, validatorReward);
        }
    }

    /**
     * @dev Allows a user to claim their pending rewards.
     * @param peerId The unique identifier of the peer. (0x for validators)
     */
    function claim(bytes32 peerId) public payable updateReward(peerId) {
        require(block.timestamp > rewardStart, "CNS: rewards not started yet");

        if (peerId != bytes32("")) {
            uint256 reward = rewards[peerId];
            require(reward > 0, "CNS: nothing to claim");
            rewards[peerId] = 0;
            L2Sender(l2Sender).sendMintMessage{value: msg.value}(peers[peerId], reward, msg.sender);
            emit UserClaimed(peers[peerId], msg.sender, reward);
        } else {
            uint256 validatorReward = validatorRewards[msg.sender];
            require(validatorReward > 0, "CNS: nothing to claim");
            validatorRewards[msg.sender] = 0;
            L2Sender(l2Sender).sendMintMessage{value: msg.value}(msg.sender, validatorReward, msg.sender);
            emit UserClaimed(msg.sender, msg.sender, validatorReward);
        }
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

    /* ========== MODIFIERS ========== */

    /**
     * @dev Modifier to update the reward variables.
     * @param peerId The unique identifier of the peer.
     */
    modifier updateReward(bytes32 peerId) {
        rewardPerContributionStored = rewardPerContribution();
        lastUpdateTime = block.timestamp > rewardStart ? block.timestamp : rewardStart;
        if (peerId != bytes32("")) {
            rewards[peerId] = earned(peerId);
            peerRewardPerContributionPaid[peerId] = rewardPerContributionStored;
        }
        _;
    }

    /**
     * @dev Modifier to check if the caller is the peer.
     * @param peerId The unique identifier of the peer.
     */
    modifier onlyPeer(bytes32 peerId) {
        require(peers[peerId] == msg.sender, "CNS: not the peer address");
        _;
    }
}
