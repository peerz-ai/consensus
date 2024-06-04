// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library Distribution {
    uint256 constant SECONDS_IN_A_DAY = 86400;
    uint256 constant SECONDS_IN_A_YEAR = 31536000;
    uint256 constant DAYS_INITIAL_PERIOD = 90;
    uint256 constant INITIAL_PERIOD_SECONDS = DAYS_INITIAL_PERIOD * SECONDS_IN_A_DAY;
    uint256 constant INITIAL_DISTRIBUTION_FRACTION = 20; // Represents 20%

    // Calculates daily token distribution based on the time elapsed since the start
    function dailyDistribution(
        uint256 maxSupply,
        uint256 startTime,
        uint256 currentTime
    )
        public
        pure
        returns (uint256 distributionAmount)
    {
        if (currentTime < startTime) return 0;

        uint256 timeElapsed = currentTime - startTime;

        uint256 initialDailyDistribution = (maxSupply * INITIAL_DISTRIBUTION_FRACTION / 100) / DAYS_INITIAL_PERIOD;

        if (timeElapsed <= INITIAL_PERIOD_SECONDS) {
            return initialDailyDistribution;
        }
        
        // Time after the initial period
        uint256 periodsElapsed = 1 + timeElapsed / SECONDS_IN_A_YEAR;

        // Apply halving based on the number of years elapsed since the initial period
        return initialDailyDistribution >> periodsElapsed;
    }

    // Calculate accumulated token distribution between last update and current time
    function calculateAccumulatedDistribution(
        uint256 maxSupply,
        uint256 startTime,
        uint256 lastUpdate,
        uint256 currentTime
    )
        public
        pure
        returns (uint256 accumulatedDistribution)
    {
        // Initialize lastUpdate to startTime if it's zero
        if (lastUpdate < startTime) {
            lastUpdate = startTime;
        }

        if (lastUpdate > currentTime) {
            lastUpdate = currentTime;
        }

        uint256 dailyDistribution = dailyDistribution(maxSupply, startTime, currentTime);

        uint256 timeElapsed = currentTime - lastUpdate;

        return dailyDistribution * timeElapsed / SECONDS_IN_A_DAY;
    }
}
