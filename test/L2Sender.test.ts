import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { IL2Sender, L1MessageReceiver, L2Sender, L2SenderV2, LZEndpointMock, PRZ } from '@/generated-types/ethers';
import { ZERO_ADDR } from '@/scripts/utils/constants';
import { wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';

describe('L2Sender', () => {
  const senderChainId = 101;
  const receiverChainId = 110;

  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;

  let lZEndpointMockL2: LZEndpointMock;
  let lZEndpointMockL1: LZEndpointMock;

  let l2Sender: L2Sender;
  let l1MessageReceiver: L1MessageReceiver;

  let rewardToken: PRZ;

  before(async () => {
    [OWNER, SECOND] = await ethers.getSigners();

    const [ERC1967ProxyFactory, LZEndpointMock, PRZFactory, L2Sender, L1MessageReceiver] = await Promise.all([
      ethers.getContractFactory('ERC1967Proxy'),
      ethers.getContractFactory('LZEndpointMock'),
      ethers.getContractFactory('PRZ'),
      ethers.getContractFactory('L2Sender'),
      ethers.getContractFactory('L1MessageReceiver'),
    ]);

    let l2SenderImplementation: L2Sender;
    let l1MessageReceiverImplementation: L1MessageReceiver;

    [lZEndpointMockL2, lZEndpointMockL1, l2SenderImplementation, l1MessageReceiverImplementation] = await Promise.all([
      LZEndpointMock.deploy(senderChainId),
      LZEndpointMock.deploy(receiverChainId),
      L2Sender.deploy(),
      L1MessageReceiver.deploy(),
    ]);

    const l1MessageReceiverProxy = await ERC1967ProxyFactory.deploy(l1MessageReceiverImplementation, '0x');
    l1MessageReceiver = L1MessageReceiver.attach(l1MessageReceiverProxy) as L1MessageReceiver;
    await l1MessageReceiver.L1MessageReceiver__init();

    rewardToken = await PRZFactory.deploy(wei(1000000000));

    await rewardToken.transferOwnership(await l1MessageReceiver.getAddress());

    const rewardTokenConfig: IL2Sender.RewardTokenConfigStruct = {
      gateway: lZEndpointMockL2,
      receiver: l1MessageReceiver,
      receiverChainId: receiverChainId,
      zroPaymentAddress: ZERO_ADDR,
      adapterParams: '0x',
    };

    const l2SenderProxy = await ERC1967ProxyFactory.deploy(l2SenderImplementation, '0x');
    l2Sender = L2Sender.attach(l2SenderProxy) as L2Sender;
    await l2Sender.L2Sender__init(OWNER, rewardTokenConfig);

    await l1MessageReceiver.setParams(rewardToken, {
      gateway: lZEndpointMockL1,
      sender: l2Sender,
      senderChainId: senderChainId,
    });

    await lZEndpointMockL2.setDestLzEndpoint(l1MessageReceiver, lZEndpointMockL1);

    await reverter.snapshot();
  });

  beforeEach(async () => {
    await reverter.revert();
  });

  describe('UUPS proxy functionality', () => {
    let rewardTokenConfig: IL2Sender.RewardTokenConfigStruct;

    before(async () => {
      rewardTokenConfig = {
        gateway: lZEndpointMockL2,
        receiver: l1MessageReceiver,
        receiverChainId: receiverChainId,
        zroPaymentAddress: ZERO_ADDR,
        adapterParams: '0x',
      };
    });

    describe('#constructor', () => {
      it('should disable initialize function', async () => {
        const reason = 'Initializable: contract is already initialized';

        const l2Sender = await (await ethers.getContractFactory('L2Sender')).deploy();

        await expect(l2Sender.L2Sender__init(OWNER, rewardTokenConfig)).to.be.revertedWithCustomError(
          l2Sender,
          'InvalidInitialization',
        );
      });
    });

    describe('#L2Sender__init', () => {
      it('should revert if try to call init function twice', async () => {
        const reason = 'Initializable: contract is already initialized';

        await expect(l2Sender.L2Sender__init(OWNER, rewardTokenConfig)).to.be.revertedWithCustomError(
          l2Sender,
          'InvalidInitialization',
        );
      });
      it('should setup config', async () => {
        expect(await l2Sender.consensus()).to.be.equal(await OWNER.getAddress());

        expect(await l2Sender.rewardTokenConfig()).to.be.deep.equal([
          await lZEndpointMockL2.getAddress(),
          await l1MessageReceiver.getAddress(),
          receiverChainId,
          ZERO_ADDR,
          '0x',
        ]);
      });
    });

    describe('#_authorizeUpgrade', () => {
      it('should correctly upgrade', async () => {
        const l2SenderV2Factory = await ethers.getContractFactory('L2SenderV2');
        const l2SenderV2Implementation = await l2SenderV2Factory.deploy();

        await l2Sender.upgradeToAndCall(l2SenderV2Implementation, '0x');

        const l2SenderV2 = l2SenderV2Factory.attach(l2Sender) as L2SenderV2;

        expect(await l2SenderV2.version()).to.eq(2);
      });
      it('should revert if caller is not the owner', async () => {
        await expect(l2Sender.connect(SECOND).upgradeToAndCall(ZERO_ADDR, '0x')).to.be.revertedWithCustomError(
          l2Sender,
          'OwnableUnauthorizedAccount',
        );
      });
    });
  });

  describe('supportsInterface', () => {
    it('should support IL2Sender', async () => {
      expect(await l2Sender.supportsInterface('0x4c07de48')).to.be.true;
    });
    it('should support IERC165', async () => {
      expect(await l2Sender.supportsInterface('0x01ffc9a7')).to.be.true;
    });
  });

  describe('setConsensus', () => {
    it('should set consensus', async () => {
      await l2Sender.setConsensus(SECOND);
      expect(await l2Sender.consensus()).to.be.equal(await SECOND.getAddress());
    });
    it('should revert if not called by the owner', async () => {
      await expect(l2Sender.connect(SECOND).setConsensus(SECOND)).to.be.revertedWithCustomError(
        l2Sender,
        'OwnableUnauthorizedAccount',
      );
    });
  });

  describe('setRewardTokenConfig', () => {
    it('should set new config', async () => {
      const newConfig = {
        gateway: l1MessageReceiver,
        receiver: lZEndpointMockL2,
        receiverChainId: 0,
        zroPaymentAddress: ZERO_ADDR,
        adapterParams: '0x',
      };

      await l2Sender.setRewardTokenConfig(newConfig);

      expect(await l2Sender.rewardTokenConfig()).to.be.deep.equal([
        await l1MessageReceiver.getAddress(),
        await lZEndpointMockL2.getAddress(),
        0,
        ZERO_ADDR,
        '0x',
      ]);
    });
    it('should revert if not called by the owner', async () => {
      await expect(
        l2Sender.connect(SECOND).setRewardTokenConfig({
          gateway: lZEndpointMockL2,
          receiver: l1MessageReceiver,
          receiverChainId: receiverChainId,
          zroPaymentAddress: ZERO_ADDR,
          adapterParams: '0x',
        }),
      ).to.be.revertedWithCustomError(
        l2Sender,
        'OwnableUnauthorizedAccount',
      );
    });
  });

  describe('sendMintMessage', () => {
    it('should send mint message', async () => {
      await l2Sender.sendMintMessage(SECOND, '999', OWNER, { value: ethers.parseEther('0.1') });
      expect(await rewardToken.balanceOf(SECOND)).to.eq('999');
    });
    it('should revert if not called by the owner', async () => {
      await expect(
        l2Sender.connect(SECOND).sendMintMessage(SECOND, '999', OWNER, { value: ethers.parseEther('0.1') }),
      ).to.be.revertedWith('L2S: invalid sender');
    });
    it('should not revert if not L1MessageReceiver sender', async () => {
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: lZEndpointMockL1,
        sender: OWNER,
        senderChainId: senderChainId,
      });

      await l2Sender.sendMintMessage(SECOND, '999', OWNER, { value: ethers.parseEther('0.1') });
      expect(await rewardToken.balanceOf(SECOND)).to.eq(0);
    });
    it('should `retryMessage` for failed message on the `L1MessageReceiver`', async () => {
      const amount = '998';

      // START send invalid call to L1MessageReceiver
      // Set invalid sender in config
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: lZEndpointMockL1,
        sender: ZERO_ADDR,
        senderChainId: senderChainId,
      });

      await l2Sender.sendMintMessage(SECOND, amount, OWNER, { value: ethers.parseEther('0.1') });
      expect(await rewardToken.balanceOf(SECOND)).to.eq('0');
      // END

      // Set valid sender in config
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: lZEndpointMockL1,
        sender: l2Sender,
        senderChainId: senderChainId,
      });

      // Must send messages even though the previous one may be blocked
      await l2Sender.sendMintMessage(SECOND, '1', OWNER, { value: ethers.parseEther('0.1') });
      expect(await rewardToken.balanceOf(SECOND)).to.eq('1');

      // START retry to send invalid message
      const senderAndReceiverAddress = ethers.solidityPacked(
        ['address', 'address'],
        [await l2Sender.getAddress(), await l1MessageReceiver.getAddress()],
      );
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [await SECOND.getAddress(), amount],
      );

      await l1MessageReceiver.retryMessage(senderChainId, senderAndReceiverAddress, 1, payload);
      expect(await rewardToken.balanceOf(SECOND)).to.eq(Number(amount) + 1);
      // END

      // Next messages shouldn't fail
      await l2Sender.sendMintMessage(SECOND, '1', OWNER, { value: ethers.parseEther('0.1') });
      expect(await rewardToken.balanceOf(SECOND)).to.eq(Number(amount) + 2);
    });
  });
});
