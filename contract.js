const { TonClient, abiContract, signerKeys, signerNone } = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const { Account } = require("@eversdk/appkit");
const locklift = require("locklift")
const Locklift = new locklift.Locklift()
const Address = Locklift.Address
const { readFileSync } = require("fs")
const path = require("path")


function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

MINIMAL_BALANCE = .01

TonClient.useBinaryLibrary(libNode);

async function main(client) {
    // 
    // 1. ------------------ Deploy multisig wallet --------------------------------
    // 
    // Generate a key pair for the wallet to be deployed
    const keypair = await client.crypto.generate_random_sign_keys();

    // TODO: Save generated keypair!
    console.log('Generated wallet keys:', JSON.stringify(keypair))
    console.log('Do not forget to save the keys!')

    // To deploy a wallet we need its TVC and ABI files
    const msigTVC =
        readFileSync(path.resolve(__dirname, "./SetcodeMultisig.tvc")).toString("base64")
    const msigABI =
        readFileSync(path.resolve(__dirname, "./SetcodeMultisig.abi.json")).toString("utf8")

    // We need to know the future address of the wallet account,
    // because its balance must be positive for the contract to be deployed
    // Future address can be calculated by encoding the deploy message.
    // https://docs.everos.dev/ever-sdk/reference/types-and-methods/mod_abi#encode_message

    const messageParams = {
        abi: { type: 'Json', value: msigABI },
        deploy_set: { tvc: msigTVC, initial_data: {} },
        signer: { type: 'Keys', keys: keypair },
        processing_try_index: 1
    }

    const encoded = await client.abi.encode_message(messageParams)

    const msigAddress = encoded.address

    console.log(`Please send >= ${MINIMAL_BALANCE} tokens to ${msigAddress}`)
    console.log(`awaiting...`)

    // Blocking here, waiting for account balance changes.
    // It is assumed that at this time you replenish this account.
    let balance
    for (; ;) {
        // The idiomatic way to send a request is to specify 
        // query and variables as separate properties.
        const getBalanceQuery = `
                query getBalance($address: String!) {
                    blockchain {
                    account(address: $address) {
                            info {
                            balance
                        }
                    }
                }
            }
            `
        const resultOfQuery = await client.net.query({
            query: getBalanceQuery,
            variables: { address: msigAddress }
        })

        const nanotokens = parseInt(resultOfQuery.result.data.blockchain.account.info?.balance, 16)
        console.log(nanotokens)
        console.log(MINIMAL_BALANCE * 1e9)
        if (nanotokens > MINIMAL_BALANCE * 1e9) {
            balance = nanotokens / 1e9
            break
        }
        // TODO: rate limiting
        await sleep(1000)
    }
    console.log(`Account balance is: ${balance.toString(10)} tokens`)

    console.log(`Deploying wallet contract to address: ${msigAddress} and waiting for transaction...`)

    // This function returns type `ResultOfProcessMessage`, see: 
    // https://docs.everos.dev/ever-sdk/reference/types-and-methods/mod_processing#process_message
    let result = await client.processing.process_message({
        message_encode_params: {
            ...messageParams,  // use the same params as for `encode_message`,
            call_set: {        // plus add `call_set`
                function_name: 'constructor',
                input: {
                    owners: [`0x${keypair.public}`],
                    reqConfirms: 1,
                    lifetime: 3600
                }
            },
        },
        send_events: false,
    })
    console.log('Contract deployed. Transaction hash', result.transaction?.id)
    assert.equal(result.transaction?.status, 3)
    assert.equal(result.transaction?.status_name, "finalized")
}

async function sendTXN(client, keys) {

    const everWalletCode =
                readFileSync(path.resolve(__dirname, "./Wallet.code.boc")).toString("base64")
    const everWalletABI =
        readFileSync(path.resolve(__dirname, "./everWallet.abi.json")).toString("utf8")

    // const stateInit = (await client.boc.encode_tvc({
    //     code:everWalletCode,
    //     data:initData
    // })).tvc;

    // const everWalletAddress = `0:`+(await client.boc.get_boc_hash({boc: stateInit})).hash;
    const msigTVC =
    readFileSync(path.resolve(__dirname, "./SetcodeMultisig.tvc")).toString("base64")
    const msigABI =
    readFileSync(path.resolve(__dirname, "./SetcodeMultisig.abi.json")).toString("utf8")

    const messageParams = {
        abi: { type: 'Json', value: msigABI },
        deploy_set: { tvc: msigTVC, initial_data: {} },
        signer: { type: 'Keys', keys: keys },
        processing_try_index: 1
    }

    let result = await client.processing.process_message({
        message_encode_params: {
            address: "0:0a9f2f53ea912f6612e240ab5cba3ec83f878859aeb8fde62cbf5ac968899a99",
            ...messageParams, // use the same params as for `encode_message`,
            call_set: {       // plus add `call_set`
                function_name: 'sendTransaction',
                input: {
                    dest: "0:172af1d268b7a2e169b216fd397c410dfb9bd13908cf293b0069932b91b87ee1",
                    value: 1e9,
                    bounce: true,
                    flags: 64,
                    payload: ''
                }
            },
        },
        send_events: false, // do not send intermidate events
    })
    console.log('Transfer completed. Transaction hash', result.transaction?.id)

//     let deployAndTransferMsg =  await client.boc.encode_external_in_message({
//         dst: "0:172af1d268b7a2e169b216fd397c410dfb9bd13908cf293b0069932b91b87ee1",
//         init: stateInit,
//         body: body
//     });

//     let sendRequestResult = await client.processing.send_message({
//         message: deployAndTransferMsg,
//         send_events: false
//     });

//     let transaction = (await client.processing.wait_for_transaction({
//         abi: { type: 'Json', value: everWalletABI },
//         message: deployAndTransferMsg.message,
//         shard_block_id: sendRequestResult.shard_block_id,
//         send_events: false
//     })).transaction;
// }
}


const client = new TonClient({
    network: {
        endpoints: ['gql-testnet.venom.foundation']
    }
});

async function run() {
    await sendTXN(client)
}

run()