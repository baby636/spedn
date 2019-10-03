import { BITBOX } from "bitbox-sdk";
import { Spedn, using } from ".";
import { ContractCoin, Module } from "./contracts";
import { P2PKH, P2PKHCoin, signWith } from "./P2PKH";
import { SigHash, TxBuilder } from "./TxBuilder";

const bitbox = new BITBOX({ restURL: "https://trest.bitcoin.com/v2/" });
const mnemonic = "draw parade crater busy book swim soldier tragic exit feel top civil";
const hdNode = bitbox.HDNode.fromSeed(bitbox.Mnemonic.toSeed(mnemonic), "testnet");
const wallet = bitbox.HDNode.derivePath(hdNode, "m/44'/145'/0'");
const key0 = bitbox.HDNode.derivePath(wallet, "0/0").keyPair;
const addr0 = P2PKH.fromKeyPair(key0);
const key1 = bitbox.HDNode.derivePath(wallet, "0/1").keyPair;
const addr1 = P2PKH.fromKeyPair(key1);
const key2 = bitbox.HDNode.derivePath(wallet, "1/0").keyPair;
const change2 = P2PKH.fromKeyPair(key2);

const coins = [
  new P2PKHCoin(
    {
      txid: "ad70c931d742d6903271d1d3047701fb25b6859c440aeacf774d242f74f10738",
      vout: 0,
      amount: 100000,
      satoshis: 100000,
      height: 12345,
      confirmations: 30
    },
    addr0.redeemScript
  ),
  new P2PKHCoin(
    {
      txid: "ad70c931d742d6903271d1d3047701fb25b6859c440aeacf774d242f74f10738",
      vout: 1,
      amount: 100000,
      satoshis: 100000,
      height: 12345,
      confirmations: 30
    },
    addr1.redeemScript
  ),
  new P2PKHCoin(
    {
      txid: "ad70c931d742d6903271d1d3047701fb25b6859c440aeacf774d242f74f10738",
      vout: 2,
      amount: 100000,
      satoshis: 100000,
      height: 12345,
      confirmations: 30
    },
    change2.redeemScript
  )
];

describe("TxBuilder", () => {
  describe("size calculation", () => {
    let builder: TxBuilder;
    beforeEach(
      () => (builder = new TxBuilder("testnet").from(coins[0], signWith(key0)).from(coins[1], signWith(key1)))
    );

    it("should calculate change output amount", () => {
      const tx = builder.to(addr0.getAddress("testnet"), 100000).to(change2.getAddress("testnet")).build();
      expect(tx.outs[1].value).toBe(100000 - tx.byteLength());
    });

    it("should protect from overpaying", () => {
      expect(() => builder.to(addr0.getAddress("testnet"), 100000).build()).toThrowError("Fee is unreasonably high.");
    });

    it("should allow overpaying if expicitly requested", () => {
      builder.to(addr0.getAddress("testnet"), 100000).build(true);
    });

    it("should protect from dust output", () => {
      expect(() =>
        builder.to(addr0.getAddress("testnet"), 199990).to(change2.getAddress("testnet")).build()
      ).toThrowError("Change output is below dust level.");
    });
  });

  describe("signing context", () => {
    it("should generate equivalent signatures for checkSig and checkDataSig", () => {
      let sig: Buffer;
      let datasig: Buffer;
      const flag = Buffer.alloc(1, SigHash.SIGHASH_ALL | SigHash.SIGHASH_FORKID);
      const tx = new TxBuilder("testnet")
        .from(coins[0], (i, c) => {
          sig = c.sign(key0);
          datasig = c.signData(key0, bitbox.Crypto.sha256(c.preimage(SigHash.SIGHASH_ALL)));

          return i.spend({ pubKey: key0.getPublicKeyBuffer(), sig });
        })
        .to(addr1.getAddress("testnet"), 9999300)
        .build();

      // @ts-ignore
      expect(sig.toString("hex")).toEqual(Buffer.concat([datasig, flag]).toString("hex"));
    });
  });

  describe("build", () => {
    let mod: Module;
    beforeAll(
      async () =>
        await using(new Spedn(), async compiler => {
          mod = await compiler.compileFile("../../examples/PayToPublicKeyHash.spedn");
        })
    );

    it("should generate valid signature", () => {
      const address = new mod.PayToPublicKeyHash({ pubKeyHash: bitbox.Crypto.sha256(key1.getPublicKeyBuffer()) });
      const utxo0 = new ContractCoin(
        {
          txid: "6b5c8d90e8ac791d00c1d70bcc7a52fb4fd9077bf07387b0db9240a919cdabdf",
          vout: 0,
          amount: 5000000,
          satoshis: 5000000,
          confirmations: 10,
          height: 100
        },
        (address as any).challenges,
        address.redeemScript
      );
      const utxo1 = new P2PKHCoin(
        {
          txid: "6b5c8d90e8ac791d00c1d70bcc7a52fb4fd9077bf07387b0db9240a919cdabdf",
          vout: 1,
          amount: 4999700,
          satoshis: 4999700,
          confirmations: 10,
          height: 100
        },
        change2.redeemScript
      );

      const tx = new TxBuilder("testnet")
        .from(utxo0, (i, c) => i.spend({ pubKey: key1.getPublicKeyBuffer(), sig: c.sign(key1) }))
        .from(utxo1, signWith(key2))
        .to(addr1.getAddress("testnet"), 9999300)
        .build();

      expect(tx.getId()).toEqual("ad70c931d742d6903271d1d3047701fb25b6859c440aeacf774d242f74f10738");
    });
  });
});
