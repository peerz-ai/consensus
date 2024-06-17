// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Distribution
 * @dev Library for calculating token distribution based on the time elapsed since the start
 */
library Distribution {
    uint256 constant SECONDS_IN_A_DAY = 86400;
    uint256 constant SECONDS_IN_A_YEAR = SECONDS_IN_A_DAY * 365;
    uint256 constant DAYS_INITIAL_PERIOD = 90;
    uint256 constant INITIAL_PERIOD_SECONDS = DAYS_INITIAL_PERIOD * SECONDS_IN_A_DAY;
    uint256 constant INITIAL_DISTRIBUTION_FRACTION = 20; // Represents 20%

    // Calculates the number of periods elapsed since the start
    function periodsElapsed(uint256 startTime, uint256 currentTime) public pure returns (uint256 period) {
        return 1 + (currentTime - startTime) / SECONDS_IN_A_YEAR;
    }

    /**
     * @dev Calculates daily token distribution based on the time elapsed since the start
     * @param maxSupply Maximum supply of the token
     * @param startTime Start time of the distribution
     * @param currentTime Current time
     * @return distributionAmount Daily distribution amount
     */
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

        if (timeElapsed < INITIAL_PERIOD_SECONDS) {
            return initialDailyDistribution;
        }

        uint256 periods = periodsElapsed(startTime, currentTime);

        return initialDailyDistribution >> periods;
    }

    /**
     * @dev Calculates accumulated distribution between last update and current time
     * @param maxSupply Maximum supply of the token
     * @param startTime Start time of the distribution
     * @param lastUpdate Last time the distribution was updated
     * @param currentTime Current time
     * @return accumulatedDistribution Accumulated distribution between last update and current time
     */
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
        if (currentTime < startTime) return 0;

        uint256 totalDailyDistribution = 0;

        while (lastUpdate < currentTime) {
            uint256 nextPeriodTime;
            uint256 _dailyDistribution = dailyDistribution(maxSupply, startTime, lastUpdate);

            if (lastUpdate < startTime + INITIAL_PERIOD_SECONDS) {
                nextPeriodTime = startTime + INITIAL_PERIOD_SECONDS;
            } else {
                uint256 periods = periodsElapsed(startTime, lastUpdate);
                nextPeriodTime = startTime + (periods * SECONDS_IN_A_YEAR);
            }

            uint256 end = currentTime < nextPeriodTime ? currentTime : nextPeriodTime;
            totalDailyDistribution += ((end - lastUpdate) * _dailyDistribution);
            lastUpdate = end;
        }

        return totalDailyDistribution / SECONDS_IN_A_DAY;
    }
}
