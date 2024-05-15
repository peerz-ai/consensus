import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
const { expect } = require("chai");

import { PRZ } from '@/generated-types/ethers';
import { wei } from '@/scripts/utils/utils';
import { Reverter } from '@/test/helpers/reverter';

describe('PRZ', () => {
  const reverter = new Reverter();

  let OWNER: SignerWithAddress;
  let SECOND: SignerWithAddress;
  let MINTER: SignerWithAddress;

  let prz: PRZ;

  const cap = wei('100');

  before(async () => {
    [OWNER, SECOND, MINTER] = await ethers.getSigners();

    const PRZFactory = await ethers.getContractFactory('PRZ');
    prz = await PRZFactory.deploy(cap);

    await reverter.snapshot();
  });

  afterEach(async () => {
    await reverter.revert();
  });

  describe('constructor', () => {
    it('should set the cap', async () => {
      expect(await prz.cap()).to.equal(cap);
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
