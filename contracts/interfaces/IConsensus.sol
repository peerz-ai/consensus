// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

interface IConsensus {
    struct Report {
        bytes32 peerId;
        uint256 startTime;
        uint256 validatorsCount;
        uint256 commitsCount;
        uint256 upvotes;
        uint256 downvotes;
    }

    struct Commit {
        bytes32 commitHash;
        bool revealed;
    }

    error LzDestAlreadySet();
    error InvalidOrigin();
    error ValidatorExists();
    error ValidatorDoesNotExist();
    error ReportExists();
    error ReportDoesNotExist();
    error AllValidatorsCommitted();
    error ValidatorCannotVote();
    error ValidatorAlreadyCommited();
    error CommitPhaseEnded();
    error RevealPhaseNotStarted();
    error RevealPhaseEnded();
    error VoteAlreadyRevealed();
    error InvalidReveal();

}
