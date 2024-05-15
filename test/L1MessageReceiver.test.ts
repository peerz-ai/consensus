import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import {
  L1MessageReceiver,
  L1MessageReceiverV2,
  Distribution,
  PRZ,
  Consensus,
  Consensus__factory,
} from '@/generated-types/ethers';
import { ZERO_ADDR, ZERO_BYTES32 } from '@/scripts/utils/constants';
import { wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';
import { getCurrentBlockTime } from './helpers/block-helper';

describe('L1MessageReceiver', () => {
  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;
  let THIRD: SignerWithAddress;

  let consensus: Consensus;
  let consensusFactory: Consensus__factory;
  let lib: Distribution;

  let l1MessageReceiver: L1MessageReceiver;
  let rewardToken: PRZ;
  before(async () => {
    [OWNER, SECOND, THIRD] = await ethers.getSigners();

    const [libFactory, ERC1967ProxyFactory, L1MessageReceiver, Prz] = await Promise.all([
      ethers.getContractFactory('Distribution'),
      ethers.getContractFactory('ERC1967Proxy'),
      ethers.getContractFactory('L1MessageReceiver'),
      ethers.getContractFactory('PRZ'),
    ]);

    lib = await libFactory.deploy();

    consensusFactory = await ethers.getContractFactory('Consensus', {
      libraries: {
        Distribution: await lib.getAddress(),
      },
    });
    const consensusImplementation = await consensusFactory.deploy();

    const consensusProxy = await ERC1967ProxyFactory.deploy(await consensusImplementation.getAddress(), '0x');
    consensus = consensusFactory.attach(await consensusProxy.getAddress()) as Consensus;

    const l1MessageReceiverImplementation = await L1MessageReceiver.deploy();
    const l1MessageReceiverProxy = await ERC1967ProxyFactory.deploy(l1MessageReceiverImplementation, '0x');
    l1MessageReceiver = L1MessageReceiver.attach(l1MessageReceiverProxy) as L1MessageReceiver;
    await l1MessageReceiver.L1MessageReceiver__init();

    rewardToken = await Prz.deploy(wei(100));

    await rewardToken.transferOwnership(await l1MessageReceiver.getAddress());

    await consensus.Consensus_init(THIRD, await getCurrentBlockTime(), await rewardToken.cap());

    await l1MessageReceiver.setParams(rewardToken, {
      gateway: THIRD,
      sender: OWNER,
      senderChainId: 2,
    });

    await reverter.snapshot();
  });

  beforeEach(async () => {
    await reverter.revert();
  });

  describe('UUPS proxy functionality', () => {
    describe('#constructor', () => {
      it('should disable initialize function', async () => {
        const l1MessageReceiver = await (await ethers.getContractFactory('L1MessageReceiver')).deploy();

        await expect(l1MessageReceiver.L1MessageReceiver__init()).to.be.revertedWithCustomError(
          l1MessageReceiver,
          'InvalidInitialization'
        );
      });
    });

    describe('#L1MessageReceiver__init', () => {
      it('should revert if try to call init function twice', async () => {
        const reason = 'Initializable: contract is already initialized';

        await expect(l1MessageReceiver.L1MessageReceiver__init()).to.be.revertedWithCustomError(
          l1MessageReceiver,
          'InvalidInitialization'
        );
      });
    });

    describe('#_authorizeUpgrade', () => {
      it('should correctly upgrade', async () => {
        const l1MessageReceiverV2Factory = await ethers.getContractFactory('L1MessageReceiverV2');
        const l1MessageReceiverV2Implementation = await l1MessageReceiverV2Factory.deploy();

        await l1MessageReceiver.upgradeToAndCall(l1MessageReceiverV2Implementation, '0x');

        const l1MessageReceiverV2 = l1MessageReceiverV2Factory.attach(l1MessageReceiver) as L1MessageReceiverV2;

        expect(await l1MessageReceiverV2.version()).to.eq(2);
      });
      it('should revert if caller is not the owner', async () => {
        await expect(l1MessageReceiver.connect(SECOND).upgradeToAndCall(ZERO_ADDR, '0x')).to.be.revertedWithCustomError(
          l1MessageReceiver,
          'OwnableUnauthorizedAccount',
        );
      });
    });
  });

  describe('#setParams', () => {
    it('should set params', async () => {
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: ZERO_ADDR,
        sender: SECOND,
        senderChainId: 1,
      });

      expect(await l1MessageReceiver.rewardToken()).to.be.equal(await rewardToken.getAddress());
      expect(await l1MessageReceiver.config()).to.be.deep.equal([ZERO_ADDR, await SECOND.getAddress(), 1n]);
    });

    it('should revert if not owner', async () => {
      await expect(
        l1MessageReceiver.connect(SECOND).setParams(ZERO_ADDR, {
          gateway: ZERO_ADDR,
          sender: OWNER,
          senderChainId: 0,
        }),
      ).to.be.revertedWithCustomError(
        l1MessageReceiver,
        'OwnableUnauthorizedAccount'
      );
    });
  });

  describe('#lzReceive', () => {
    it('should mint tokens', async () => {
      const address = ethers.solidityPacked(
        ['address', 'address'],
        [await OWNER.getAddress(), await l1MessageReceiver.getAddress()],
      );
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [await SECOND.getAddress(), wei(1)],
      );
      const tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(1));
    });
    it('should mint tokens', async () => {
      const address = ethers.solidityPacked(
        ['address', 'address'],
        [await OWNER.getAddress(), await l1MessageReceiver.getAddress()],
      );
      let payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [await SECOND.getAddress(), wei(95)],
      );
      let tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(95));
      payload = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [await SECOND.getAddress(), wei(2)]);
      tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 6, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(2));
      payload = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [await SECOND.getAddress(), wei(5)]);
      tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 7, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, 0);
      expect(await l1MessageReceiver.failedMessages(2, address, 7)).to.eq(ethers.keccak256(payload));
    });
    it('should revert if provided wrong lzEndpoint', async () => {
      await expect(l1MessageReceiver.lzReceive(0, '0x', 1, '0x')).to.be.revertedWith('L1MR: invalid gateway');
    });
    it('should fail if provided wrong mint amount', async () => {
      const address = ethers.solidityPacked(
        ['address', 'address'],
        [await OWNER.getAddress(), await l1MessageReceiver.getAddress()],
      );
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [await SECOND.getAddress(), wei(100)],
      );

      let tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(100));

      expect(await l1MessageReceiver.failedMessages(2, address, 5)).to.eq(ZERO_BYTES32);
      await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
      expect(await l1MessageReceiver.failedMessages(2, address, 5)).to.eq(ethers.keccak256(payload));

      await rewardToken.connect(SECOND).burn(wei(100));

      tx = await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 6, payload);
      expect(await l1MessageReceiver.failedMessages(2, address, 6)).to.eq(ZERO_BYTES32);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(100));
    });
    it('should fail if provided wrong mint amount', async () => {
      const address = ethers.solidityPacked(
        ['address', 'address'],
        [await OWNER.getAddress(), await l1MessageReceiver.getAddress()],
      );
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [await SECOND.getAddress(), wei(100)],
      );

      await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);

      expect(await l1MessageReceiver.failedMessages(2, address, 5)).to.eq(ZERO_BYTES32);
      await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
      expect(await l1MessageReceiver.failedMessages(2, address, 5)).to.eq(ethers.keccak256(payload));

      await rewardToken.connect(SECOND).burn(wei(100));

      await l1MessageReceiver.connect(THIRD).lzReceive(2, address, 5, payload);
    });
  });

  describe('#nonblockingLzReceive', () => {
    it('should revert if invalid caller', async () => {
      await expect(l1MessageReceiver.nonblockingLzReceive(2, '0x', '0x')).to.be.revertedWith('L1MR: invalid caller');
    });
  });

  describe('#retryMessage', () => {
    let senderAndReceiverAddresses = '';
    let payload = '';
    const chainId = 2;

    beforeEach(async () => {
      senderAndReceiverAddresses = ethers.solidityPacked(
        ['address', 'address'],
        [await SECOND.getAddress(), await l1MessageReceiver.getAddress()],
      );
      payload = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [await SECOND.getAddress(), wei(99)]);

      // Fail this call
      await l1MessageReceiver.connect(THIRD).lzReceive(chainId, senderAndReceiverAddresses, 999, payload);
    });
    it('should have one blocked message', async () => {
      expect(await l1MessageReceiver.failedMessages(chainId, senderAndReceiverAddresses, 999)).to.eq(
        ethers.keccak256(payload),
      );
    });
    it('should retry failed message', async () => {
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: THIRD,
        sender: SECOND,
        senderChainId: 2,
      });

      const tx = await l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, payload);
      await expect(tx).to.changeTokenBalance(rewardToken, SECOND, wei(99));

      expect(await l1MessageReceiver.failedMessages(chainId, senderAndReceiverAddresses, 999)).to.eq(ZERO_BYTES32);
    });
    it('should revert if invalid caller', async () => {
      await expect(l1MessageReceiver.nonblockingLzReceive(chainId, '0x', '0x')).to.be.revertedWith(
        'L1MR: invalid caller',
      );
    });
    it('should revert if provided wrong chainId', async () => {
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: THIRD,
        sender: SECOND,
        senderChainId: 3,
      });

      await expect(
        l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, payload),
      ).to.be.revertedWith('L1MR: invalid sender chain ID');
    });
    it('should revert if provided wrong sender', async () => {
      await expect(
        l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, payload),
      ).to.be.revertedWith('L1MR: invalid sender address');
    });
    it('should revert if provided wrong message', async () => {
      await expect(
        l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 998, payload),
      ).to.be.revertedWith('L1MR: no stored message');
    });
    it('should revert if provided wrong payload', async () => {
      await expect(l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, '0x')).to.be.revertedWith(
        'L1MR: invalid payload',
      );
    });
    it('should revert if try to retry already retried message', async () => {
      await l1MessageReceiver.setParams(rewardToken, {
        gateway: THIRD,
        sender: SECOND,
        senderChainId: 2,
      });

      await l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, payload);

      await expect(
        l1MessageReceiver.retryMessage(chainId, senderAndReceiverAddresses, 999, payload),
      ).to.be.revertedWith('L1MR: no stored message');
    });
  });
});
