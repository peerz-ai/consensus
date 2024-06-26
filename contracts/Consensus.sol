// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.22;

import { ILayerZeroReceiver, Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroReceiver.sol";

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import { IConsensus } from "./interfaces/IConsensus.sol";

import "hardhat/console.sol";

contract Consensus is IConsensus, ILayerZeroReceiver {
    uint256 public constant COMMIT_PHASE_DURATION = 12 hours;
    uint256 public constant REVEAL_PHASE_DURATION = 12 hours;

    address public lzEndpoint;
    bytes32 public lzDest;
    uint32 public lzEid;

    uint256 public totalReports;

    mapping(uint256 => Report) public reportDetails;
    mapping(uint256 => mapping(address => bool)) public votes;
    mapping(address => mapping(uint256 => Commit)) public commits;

    mapping(address => uint256) public validatorJoinTime;
    mapping(address => uint256) public validatorLastUpdateCount;
    mapping(address => uint256) public validatorVotesCount;

    uint256 public activeValidatorsCount;

    event ReportCreated(uint256 reportId, bytes32 peerId, uint256 startTime, uint256 activeValidatorsCount);
    event VoteCommitted(uint256 reportId, address validator, bytes32 commitHash);
    event VoteRevealed(uint256 reportId, address validator, bool vote);
    event ConsensusReached(uint256 reportId, uint256 upvotes, uint256 downvotes);

    constructor(
        address _lzEndpoint, bytes32 _lzDest, uint32 _lzEid
    ) {
        lzEndpoint = _lzEndpoint;
        lzDest = _lzDest;
        lzEid = _lzEid;
    }

    function setLzDest(bytes32 _lzDest) public {
        if(lzDest != bytes32(0)) {
            revert LzDestAlreadySet();
        }
        lzDest = _lzDest;
    }

    function allowInitializePath(Origin calldata origin) public view virtual returns (bool) {
        return origin.srcEid == lzEid && origin.sender == lzDest;
    }

    function nextNonce(uint32, bytes32) public view virtual returns (uint64 nonce) {
        return 0;
    }

    function lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata payload,
        address _executor,
        bytes calldata _extraData
    ) public payable override {
        if (!allowInitializePath(_origin)) {
            revert InvalidOrigin();
        }
        (address validator, bytes32 peerId, uint256 reportId) = abi.decode(payload, (address, bytes32, uint256));

        if (peerId == bytes32(0)) { // New validator
            if (validatorJoinTime[validator] != 0) {
                revert ValidatorExists();
            }
            validatorJoinTime[validator] = block.timestamp;
            activeValidatorsCount++;
            validatorLastUpdateCount[validator] = totalReports;
        } else { // New report
            if (validatorJoinTime[validator] == 0) {
                revert ValidatorDoesNotExist();
            }
            if (reportDetails[reportId].peerId != bytes32(0)) {
                revert ReportExists();
            }

            totalReports++;
            votes[reportId][validator] = true;
            commits[validator][reportId] = Commit(keccak256(abi.encodePacked(true, "first")), true);
            validatorVotesCount[validator]++;

            reportDetails[reportId] = Report(
                peerId,
                block.timestamp,
                activeValidatorsCount,
                1,
                1,
                0
            );

            emit ReportCreated(reportId, peerId, block.timestamp, activeValidatorsCount);
            emit VoteRevealed(reportId, validator, true);
        }
    }

    function commitVote(uint256 reportId, bytes32 commitHash) public
        validatorExists(msg.sender)
        reportExists(reportId)
    {
        if (reportDetails[reportId].commitsCount == reportDetails[reportId].validatorsCount) {
            revert AllValidatorsCommitted();
        }
        if (validatorJoinTime[msg.sender] > reportDetails[reportId].startTime) {
            revert ValidatorCannotVote();
        }
        if (commits[msg.sender][reportId].commitHash != bytes32(0)) {
            revert ValidatorAlreadyCommited();
        }
        if (block.timestamp > reportDetails[reportId].startTime + COMMIT_PHASE_DURATION) {
            revert CommitPhaseEnded();
        }

        commits[msg.sender][reportId] = Commit(commitHash, false);
        reportDetails[reportId].commitsCount++;

        emit VoteCommitted(reportId, msg.sender, commitHash);
    }

    function revealVote(uint256 reportId, bool vote, string memory salt) public payable
        validatorExists(msg.sender)
        reportExists(reportId)
    {
        Report memory report = reportDetails[reportId];
        if (report.validatorsCount != report.commitsCount || block.timestamp < report.startTime + COMMIT_PHASE_DURATION) {
            revert RevealPhaseNotStarted();
        }
        if (block.timestamp > report.startTime + COMMIT_PHASE_DURATION + REVEAL_PHASE_DURATION) {
            revert RevealPhaseEnded();
        }
        if (commits[msg.sender][reportId].commitHash == bytes32(0)) {
            revert ValidatorCannotVote();
        }
        if (commits[msg.sender][reportId].revealed) {
            revert VoteAlreadyRevealed();
        }

        bytes32 commitHash = keccak256(abi.encodePacked(vote, salt));
        if (commitHash != commits[msg.sender][reportId].commitHash) {
            revert InvalidReveal();
        }

        commits[msg.sender][reportId].revealed = true;
        validatorLastUpdateCount[msg.sender]++;
        totalReports++;

        if (vote) {
            reportDetails[reportId].upvotes++;
        } else {
            reportDetails[reportId].downvotes++;
        }

        emit VoteRevealed(reportId, msg.sender, vote);

        // Check if the reveal phase is complete and finalize the consensus
        if (reportDetails[reportId].upvotes + reportDetails[reportId].downvotes == reportDetails[reportId].validatorsCount) {
            emit ConsensusReached(reportId, reportDetails[reportId].upvotes, reportDetails[reportId].downvotes);
            // Send the consensus back to L1
            sendConsensusToL1(reportId);
        }
    }

    function sendConsensusToL1(uint256 reportId) internal {
        bytes memory payload = abi.encode(reportId, reportDetails[reportId].upvotes, reportDetails[reportId].downvotes);
        // Here you would send the payload back to L1 using LayerZero
        // The actual implementation depends on the LayerZero library you are using
        // For example:
        // ILayerZeroEndpoint(lzEndpoint).send(lzEid, lzDest, payload, payable(address(this)), address(0), bytes(""));
    }

    modifier validatorExists(address validator) {
        if (validatorJoinTime[validator] == 0) {
            revert ValidatorDoesNotExist();
        }
        _;
    }

    modifier reportExists(uint256 reportId) {
        if (reportDetails[reportId].peerId == bytes32(0)) {
            revert ReportDoesNotExist();
        }
        _;
    }
}
