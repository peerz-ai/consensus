// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import { ILayerZeroEndpointV2, MessagingParams } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

import { Distribution } from "./libs/Distribution.sol";

import { IPeerzProtocol } from "./interfaces/IPeerzProtocol.sol";
import { IPRZ } from "./interfaces/IPRZ.sol";

import "hardhat/console.sol";

/**
 * @title PeerzProtocol
 * @dev The PeerzProtocol contract is responsible for managing the state of the peerz network.
 */
contract PeerzProtocol is IPeerzProtocol {
    uint256 public constant SECURED_AMOUNT = 10_000 ether;
    uint256 public constant SLASH_AMOUNT = 2_000 ether;
    uint256 public constant WITHDRAW_WAITING = 2 days;
    uint256 public constant REPORT_WINDOW = 1 days;

    address public lzEndpoint;
    bytes32 public lzDest;
    uint32 public lzEid;

    address public rewardToken;

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

    mapping(address => bool) public validators;
    mapping(address => uint256) public validatorRewards;
    uint256 public activeValidatorsCount;

    struct Report {
        address reporter;
        uint256 timestamp;
        bool slashed;
        uint256 validationsCount;
        uint256 totalReporters;
    }

    Report[] public reports;
    mapping(bytes32 => uint256) public activeReports; // peerId => reportId

    mapping(bytes32 => mapping(address => bool)) public reportedPeers;
    mapping(bytes32 => uint256) public reportedPeerCount;


    constructor(
        address _rewardToken,
        address _lzEndpoint,
        bytes32 _lzDest,
        uint32 _lzEid,
        uint256 _rewardStart,
        uint256 _maxSupply
    ) {
        rewardToken = _rewardToken;
        lzEndpoint = _lzEndpoint;
        lzDest = _lzDest;
        lzEid = _lzEid;
        rewardStart = _rewardStart;
        maxSupply = _maxSupply;

        // initialize empty report for the first index
        reports.push(Report(address(0), 0, false, 0, 0));
    }

    /**
     * @dev Set validator state
     * @param account The validator's address.
     * @param isActive The validator's state.
     */
    function setValidator(address account, bool isActive) external {
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
        // transfer secured amount after 90 days
        if (block.timestamp > rewardStart + Distribution.DAYS_INITIAL_PERIOD) {
            IPRZ(rewardToken).transferFrom(msg.sender, address(this), SECURED_AMOUNT);
        }
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
        if (activePeers.length == 0 || peerId != activePeers[activePeersIndexes[peerId]]) revert PeerNotActive();
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
     * @param options The options for the lz.
     */
    function reportPeer(
        bytes32 peerId,
        bytes calldata options
    ) public payable updateReward(peerId) onlyValidator {
        if (activePeers.length == 0 || peerId != activePeers[activePeersIndexes[peerId]]) revert PeerNotActive();
        if (activeReports[peerId] != 0) revert PeerAlreadyReported();

        // add report
        reports.push(Report(msg.sender, block.timestamp, false, 0, 1));
        activeReports[peerId] = reports.length - 1;

        bytes memory payload_ = abi.encode(msg.sender, peerId, activeReports[peerId]);

        console.logBytes(payload_);

        ILayerZeroEndpointV2(lzEndpoint).send{ value: msg.value }(
            MessagingParams(lzEid, lzDest, payload_, options, false),
            msg.sender
        );
    }

    /**
     * @dev Allows a user to claim their pending rewards.
     * @param peerId The unique identifier of the peer. (0x for validators)
     */
    function claim(bytes32 peerId) public payable updateReward(peerId) {
        if (block.timestamp < rewardStart) revert RewardsNotStarted();

        /* if (peerId != bytes32(0)) {
            uint256 reward = rewards[peerId];
            if (reward == 0) revert NothingToClaim();
            rewards[peerId] = 0;
            Consensus(consensus).sendMintMessage{value: msg.value}(peers[peerId], reward, msg.sender);
            emit UserClaimed(peers[peerId], msg.sender, reward);
        } else {
            uint256 validatorReward = validatorRewards[msg.sender];
            if (validatorReward == 0) revert NothingToClaim();
            validatorRewards[msg.sender] = 0;
            Consensus(consensus).sendMintMessage{value: msg.value}(msg.sender, validatorReward, msg.sender);
            emit UserClaimed(msg.sender, msg.sender, validatorReward);
        } */
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
