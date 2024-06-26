// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

interface IPeerzProtocol {
    /**
     * The event that is emitted when the peer is registered.
     * @param peerId The peer's id.
     * @param account The peer's address.
     */
    event PeerRegistered(bytes32 indexed peerId, address indexed account);

    /**
     * The event that is emitted when the validator is registered or unregistered.
     * @param account The validator's address.
     * @param isActive The validator's state.
     */
    event ValidatorStateChanged(address indexed account, bool isActive);

    /**
     * The event that is emitted when the peer's contribution is updated.
     * @param peerId The peer's id.
     * @param contribution The peer's contribution.
     */
    event PeerContributionUpdated(bytes32 indexed peerId, uint256 contribution);

    /**
     * The event that is emitted when the peer's address is updated.
     * @param peerId The peer's id.
     * @param account The peer's address.
     */
    event PeerAddressUpdated(bytes32 indexed peerId, address indexed account);

    /**
     * The event that is emitted when the peer is deactivated.
     * @param peerId The peer's id.
     */
    event PeerDeactivated(bytes32 indexed peerId);

    /**
     * The event that is emitted when the peer's balance is updated.
     * @param account The peer's address.
     * @param amount The peer's amount.
     */
    event BalancesUpdated(address account, uint256 amount);

    /**
     * The event that is emitted when the user claims rewards from the pool.
     * @param user The user's address.
     * @param receiver The receiver's address.
     * @param amount The amount of tokens.
     */
    event UserClaimed(address indexed user, address receiver, uint256 amount);

    /**
     * The event that is emitted when the validator's rewards are updated.
     * @param account The validator's address.
     * @param amount The validator's amount.
     */
    event ValidatorRewardsUpdated(address indexed account, uint256 amount);

    /**
     * The error that is thrown when the peer exists.
     */
    error PeerExists();

    /**
     * The error that is thrown when the peer does not exist.
     */
    error PeerDoesNotExist();

    /**
     * The error that is thrown when the peer is not active.
     */
    error PeerNotActive();

    /**
     * The error that is thrown when the peer is not authorized.
     */
    error PeerNotAuthorized();

    /**
     * The error that is thrown when the validator state is invalid.
     */
    error InvalidValidatorState();

    /**
     * The error that is thrown when the validator is not authorized.
     */
    error ValidatorNotAuthorized();

    /**
     * The error that is thrown when the contribution is 0.
     */
    error InvalidContribution();

    /**
     * The error that is thrown when the index is invalid.
     */
    error InvalidIndex();

    /**
     * The error that is thrown when the peer already reported by an address.
     */
    error PeerAlreadyReported();

    /**
     * The error that is thrown when trying to claim before the reward start time.
     */
    error RewardsNotStarted();

    /**
     * The error that is thrown when trying to claim nothing.
     */
    error NothingToClaim();

    /**
     * The function to get the peer's address by id.
     * @param peerId The peer's id.
     * @return peerAddress peer's address.
     */
    function peers(bytes32 peerId) external view returns (address peerAddress);

    /**
     * The function to get the peer's balance by address.
     * @param peerId The peer's id.
     * @return peerBalance peer's balance.
     */
    function rewards(bytes32 peerId) external view returns (uint256 peerBalance);

    /**
     * The function to get the validator existance.
     * @param account The validator address.
     * @return exists The validator existance.
     */
    function validators(address account) external view returns (bool exists);

    /**
     * The function to get the validator's balance.
     * @param account The validator address.
     * @return amount The validator's balance.
     */
    function validatorRewards(address account) external view returns (uint256 amount);

    /**
     * The function to register the peer.
     * @param peerId The peer's id.
     * @param contribution The peer's contribution.
     */
    function registerPeer(bytes32 peerId, uint256 contribution) external;

    /**
     * The function to report the peer's contribution.
     * @param peerId The peer's id.
     */
    function reportPeer(
        bytes32 peerId,
        bytes calldata options
    ) external payable;

    /**
     * The function to claim the rewards.
     * @param peerId The peer's id.
     */
    function claim(bytes32 peerId) external payable;
}
