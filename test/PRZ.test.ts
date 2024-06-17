import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
const { expect } = require("chai");

import { PRZ, PoolMock } from '@/generated-types/ethers';
import { fromWei, wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';

describe('PRZ', () => {
  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;
  let MINTER: SignerWithAddress;

  let prz: PRZ;
  let pool: PoolMock;

  const cap = wei('100');

  before(async () => {
    [OWNER, SECOND, MINTER] = await ethers.getSigners();

    const PRZFactory = await ethers.getContractFactory('PRZ');
    prz = await PRZFactory.deploy(cap);

    const PoolFactory = await ethers.getContractFactory('PoolMock');
    pool = await PoolFactory.deploy();

    await reverter.snapshot();
  });

  afterEach(async () => {
    await reverter.revert();
  });

  describe('constructor', () => {
    it('should set the cap', async () => {
      expect(await prz.cap()).to.equal(cap);
    });

    it('should revert if cap is zero', async () => {
      const PRZFactory = await ethers.getContractFactory('PRZ');
      await expect(PRZFactory.deploy(0)).to.be.revertedWithCustomError(
        prz,
        'ERC20InvalidCap'
      );
    });

    it('should set the name and symbol', async () => {
      expect(await prz.name()).to.equal('PRZ');
      expect(await prz.symbol()).to.equal('PRZ');
    });
  });

  describe('supportsInterface', () => {
    it('should support IPRZ', async () => {
      expect(await prz.supportsInterface('0x75937bf3')).to.be.true;
    });
    it('should support IERC20', async () => {
      expect(await prz.supportsInterface('0x36372b07')).to.be.true;
    });
    it('should support IERC165', async () => {
      expect(await prz.supportsInterface('0x01ffc9a7')).to.be.true;
    });
  });

  describe('minter', () => {
    it('MINTER is owner', async () => {
      await prz.transferOwnership(await MINTER.getAddress());
      expect(await prz.owner()).equals(await MINTER.getAddress());
    });
  });

  describe('mint', () => {
    it('should mint tokens', async () => {
      const amount = wei('10');

      const tx = await prz.mint(await SECOND.getAddress(), amount);
      await expect(tx).to.changeTokenBalance(prz, SECOND, amount);
    });

    it('should revert if minting to the zero address', async () => {
      await expect(prz.mint('0x0000000000000000000000000000000000000000', wei('10'))).to.be.revertedWithCustomError(
        prz,
        'ERC20InvalidReceiver'
      );
    });

    it('should not mint more than the cap', async () => {
      await expect(prz.mint(await SECOND.getAddress(), cap + 1n)).to.be.revertedWithCustomError(
        prz,
        'ERC20ExceededCap'
      );
    });

    it('should revert if not called by the minter', async () => {
      await expect(prz.connect(SECOND).mint(await SECOND.getAddress(), wei('10'))).to.be.revertedWithCustomError(
        prz,
        'OwnableUnauthorizedAccount'
      );
    });
  });

  describe('disableOnlyEOA', () => {
    it('should revert if called when already disabled', async () => {
      const signatures = [];

      await prz.mint(await OWNER.getAddress(), wei('10'));
      signatures.push(await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['address', 'bool'], [await prz.getAddress(), false]))));

      await prz.disableOnlyEOA(signatures);
      await expect(prz.disableOnlyEOA(signatures)).to.be.revertedWith('PRZ: EOA restriction has already been toggled off');
    });

    it('should disable onlyEOA with sufficient votes', async () => {
      const signatures = [];
      const signers = await ethers.getSigners();
      const amountPerSigner = wei('1');
      await Promise.all(signers.map(async (signer) => prz.mint(await signer.getAddress(), amountPerSigner)));

      const totalSupply = await prz.totalSupply();

      for (let i = 0; i < signers.length; i++) {
        const onlyEoa: boolean = (BigInt(signatures.length) * amountPerSigner) > Number(totalSupply) * 66 / 100;
        signatures.push(await signers[i].signMessage(ethers.toBeArray(
          ethers.solidityPackedKeccak256(['address', 'bool'], [
            await prz.getAddress(),
            onlyEoa
          ])
        )));
      }

      await prz.disableOnlyEOA(signatures);
      expect(await prz.onlyEOA()).to.be.false;
    });

    it('should revert if voting threshold not met', async () => {
      const signatures = [];
      const insufficientVotes = (await prz.totalSupply() * 65n) / 100n;

      await prz.mint(await OWNER.getAddress(), insufficientVotes);
      signatures.push(await OWNER.signMessage(ethers.toBeArray(ethers.solidityPackedKeccak256(['address', 'bool'], [await prz.getAddress(), false]))));

      await expect(prz.disableOnlyEOA(signatures)).to.be.revertedWith('PRZ: voting threshold not met');
    });
  });

  describe('transfer', () => {
    it('should revert if trying to transfer to contract', async () => {
      await prz.mint(await SECOND.getAddress(), wei('10'));
      await expect(prz.connect(SECOND).transfer(await pool.getAddress(), wei('10'))).to.be.revertedWith(
        'PRZ: only EOA allowed'
      );
    });
    it('should transfer tokens to EOA', async () => {
      await prz.mint(await OWNER.getAddress(), wei('10'));
      const tx = await prz.transfer(await SECOND.getAddress(), wei('5'));
      await expect(tx).to.changeTokenBalance(prz, SECOND, wei('5'));
    });
  });

  describe('transferFrom', () => {
    it('should transfer tokens from another account with allowance', async () => {
      await prz.mint(await OWNER.getAddress(), wei('10'));
      await prz.approve(await SECOND.getAddress(), wei('5'));
      const tx = await prz.connect(SECOND).transferFrom(await OWNER.getAddress(), await MINTER.getAddress(), wei('5'));
      await expect(tx).to.changeTokenBalance(prz, MINTER, wei('5'));
    });

    it('should revert if transfer amount exceeds allowance', async () => {
      await prz.mint(await OWNER.getAddress(), wei('10'));
      await prz.approve(await SECOND.getAddress(), wei('5'));
      await expect(prz.connect(SECOND).transferFrom(await OWNER.getAddress(), await MINTER.getAddress(), wei('10'))).to.be.revertedWithCustomError(
        prz,
        'ERC20InsufficientAllowance'
      );
    });
  });

  describe('burn', () => {
    it('should burn tokens', async () => {
      const amount = wei('10');

      await prz.mint(await OWNER.getAddress(), amount);

      const tx = await prz.burn(amount);

      await expect(tx).to.changeTokenBalance(prz, OWNER, -amount);
    });
  });

  describe('burnFrom', () => {
    it('should burn tokens from another account', async () => {
      const amount = wei('10');

      await prz.mint(await OWNER.getAddress(), amount);

      await prz.approve(await SECOND.getAddress(), amount);

      const tx = await prz.connect(SECOND).burnFrom(await OWNER.getAddress(), amount);

      await expect(tx).to.changeTokenBalance(prz, OWNER, -amount);

      expect(await prz.allowance(await OWNER.getAddress(), await SECOND.getAddress())).to.equal(0);
    });
  });
});
