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

    bytes32[] public activePeers;
    mapping(bytes32 => address) public peers;
    mapping(bytes32 => uint256) public activePeersIndexes;

    uint256 public constant VALIDATOR_PERCENTAGE = 20;

    mapping(address => bool) public validators;
    mapping(address => uint256) public validatorRewards;
    uint256 public activeValidatorsCount;

    mapping(bytes32 => mapping(address => bool)) public reportedPeers;
    mapping(bytes32 => uint256) public reportedPeerCount;


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
     * @param isActive The validator's state.
     */
    function setValidator(address account, bool isActive) external onlyOwner {
        if (validators[account] == isActive) revert InvalidValidatorState();
        if (isActive) {
            activeValidatorsCount += 1;
        } else {
            activeValidatorsCount -= 1;
        }
        validators[account] = isActive;

        emit ValidatorStateChanged(account, isActive);
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
        if (peers[peerId] != address(0)) revert PeerExists();
        if (contribution == 0) revert InvalidContribution();
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
        if (contribution == 0) revert InvalidContribution();

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
        if (start >= activePeers.length || end >= activePeers.length || start > end) revert InvalidIndex();
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
        if (peers[peerId] == address(0)) revert PeerDoesNotExist();
        if (activePeers.length == 0 || peerId != activePeers[activePeersIndexes[peerId]]) revert PeerNotActive();
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
        bytes32 peerId
    ) public onlyValidator {
        if (activePeers.length == 0 || peerId != activePeers[activePeersIndexes[peerId]]) revert PeerNotActive();
        if (reportedPeers[peerId][msg.sender]) revert PeerAlreadyReported();

        reportedPeers[peerId][msg.sender] = true;
        reportedPeerCount[peerId] += 1;

        // atleast 67% of validators should report
        if (reportedPeerCount[peerId] >= activeValidatorsCount * 2 / 3) {
            _deactivatePeer(peerId);
            // Distribute rewards
            rewards[peerId] = earned(peerId);

            // slashing
            uint256 validatorsReward = rewards[peerId] * VALIDATOR_PERCENTAGE / 100;
            rewards[peerId] = rewards[peerId] - validatorsReward;

            uint256 validatorReward = validatorsReward / reportedPeerCount[peerId];
            /* for (uint256 i = 0; i < reportedPeerCount[peerId]; i++) {
                address validator = _acceptedValidators[i];
                validatorRewards[validator] += validatorReward;
                // emit event
                emit BalancesUpdated(validator, validatorReward);
            } */
        }

    }

    /**
     * @dev Allows a user to claim their pending rewards.
     * @param peerId The unique identifier of the peer. (0x for validators)
     */
    function claim(bytes32 peerId) public payable updateReward(peerId) {
        if (block.timestamp < rewardStart) revert RewardsNotStarted();

        if (peerId != bytes32(0)) {
            uint256 reward = rewards[peerId];
            if (reward == 0) revert NothingToClaim();
            rewards[peerId] = 0;
            L2Sender(l2Sender).sendMintMessage{value: msg.value}(peers[peerId], reward, msg.sender);
            emit UserClaimed(peers[peerId], msg.sender, reward);
        } else {
            uint256 validatorReward = validatorRewards[msg.sender];
            if (validatorReward == 0) revert NothingToClaim();
            validatorRewards[msg.sender] = 0;
            L2Sender(l2Sender).sendMintMessage{value: msg.value}(msg.sender, validatorReward, msg.sender);
            emit UserClaimed(msg.sender, msg.sender, validatorReward);
        }
    }

    function removeUpgradeability() external onlyOwner {
        isNotUpgradeable = true;
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {
        if (isNotUpgradeable) {
            revert();
        }
    }

    /* ========== MODIFIERS ========== */

    /**
     * @dev Modifier to update the reward variables.
     * @param peerId The unique identifier of the peer.
     */
    modifier updateReward(bytes32 peerId) {
        rewardPerContributionStored = rewardPerContribution();
        lastUpdateTime = block.timestamp > rewardStart ? block.timestamp : rewardStart;
        if (peerId != bytes32(0)) {
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
        if (peers[peerId] != msg.sender) {
            revert PeerNotAuthorized();
        }
        _;
    }

    /**
     * @dev Modifier to check if the caller is a validator.
     */
    modifier onlyValidator() {
        if (!validators[msg.sender]) {
            revert ValidatorNotAuthorized();
        }
        _;
    }
}
