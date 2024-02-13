import { PeerzProtocol } from './../typechain-types/contracts/PeerzProtocol';
import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import BigNumber from "bignumber.js";

describe("Peerz", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deploy() {
    
  }
  
  describe("Constructor", function () {
    it("Should set the correct initial state", async function () {
      const PeerzProtocol = await ethers.getContractFactory("PeerzProtocol");
      const peerz = await PeerzProtocol.deploy();
      const [owner] = await ethers.getSigners();
      const tx = await peerz.testSignature(
        ['0x5f76a02d57c4522efaad4f5152b037aab3217dadd0f826c651f507566eb7cf04'],
        [338],
        [2],
        '0x26d86c36d51adcd4b65da47cf6b734d9afbe7aba02d9d79cc1e388c1048e584f2e793f100b74ccde9ff7b3d98ec7a3cacc7afd792140f0b4a88970685767df5b1c',
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
      )

      console.log(tx);
    

    });
  });
});

