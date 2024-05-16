// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IConsensus, Distribution} from "../Consensus.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {LZEndpointMock} from "@layerzerolabs/solidity-examples/contracts/lzApp/mocks/LZEndpointMock.sol";

contract ConsensusV2 is UUPSUpgradeable {
    function version() external pure returns (uint256) {
        return 2;
    }

    function calculateAccumulatedDistribution(uint256 maxSupply_, uint256 startTime_, uint256 lastUpdate_, uint256 currentTime_) public view returns (uint256) {
        return Distribution.calculateAccumulatedDistribution(maxSupply_, startTime_, lastUpdate_, currentTime_);
    }

    function _authorizeUpgrade(address) internal view override {}
}
