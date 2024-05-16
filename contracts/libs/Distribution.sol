// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "hardhat/console.sol";

library Distribution {
    uint256 constant SECONDS_IN_A_DAY = 86400;
    uint256 constant SECONDS_IN_A_YEAR = 31536000;
    uint256 constant DAYS_INITIAL_PERIOD = 90;
    uint256 constant INITIAL_PERIOD_SECONDS = DAYS_INITIAL_PERIOD * SECONDS_IN_A_DAY;
    uint256 constant INITIAL_DISTRIBUTION_FRACTION = 20; // Represents 20%

    // Calculates daily token distribution based on the time elapsed since the start
    function dailyDistribution(
        uint256 totalSupply,
        uint256 startTime,
        uint256 currentTime
    )
        public
        pure
        returns (uint256 distributionAmount)
    {
        require(currentTime >= startTime, "Current time is before start time.");
        uint256 timeElapsed = currentTime - startTime;

        uint256 initialDailyDistribution = (totalSupply * INITIAL_DISTRIBUTION_FRACTION / 100) / DAYS_INITIAL_PERIOD;

        if (timeElapsed < INITIAL_PERIOD_SECONDS) {
            return initialDailyDistribution;
        }
        
        // Time after the initial period
        uint256 periodsElapsed = timeElapsed / SECONDS_IN_A_YEAR;

        // Apply halving based on the number of years elapsed since the initial period
        return initialDailyDistribution >> periodsElapsed;
    }

    // Calculate accumulated token distribution between last update and current time
    function calculateAccumulatedDistribution(
        uint256 totalSupply,
        uint256 startTime,
        uint256 lastUpdate,
        uint256 currentTime
    )
        public
        pure
        returns (uint256 accumulatedDistribution)
    {
        require(currentTime > lastUpdate, "Current time must be greater than last update time.");
        
        if (lastUpdate == 0) {
            lastUpdate = startTime; // Initialize lastUpdate to startTime if it's zero
        }

        uint256 dailyDistribution = dailyDistribution(totalSupply, startTime, currentTime);

        uint256 timeElapsed = currentTime - lastUpdate;

        return dailyDistribution * timeElapsed / SECONDS_IN_A_DAY;
    }
}
