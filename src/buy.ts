import {Connection} from '@solana/web3.js';
import dotenv from 'dotenv';
import {createWallet} from "./okx/core/wallet";
import {OKXDexClient} from "./okx";
import {Scheduler} from "./scheduler";

interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
    price: string;
}

dotenv.config();
const SOL_ADDRESS = '11111111111111111111111111111111'; // SOL
const TARGET_ADDRESS = process.env.TARGET_TOKEN_ADDRESS!; // Target token address (e.g., USDC on Solana)
const TRADE_INTERVAL_SEC_MIN = Number(process.env.TRADE_INTERVAL_SEC!.split('-')[0]);
const TRADE_INTERVAL_SEC_MAX = Number(process.env.TRADE_INTERVAL_SEC!.split('-')[1]);
const LOWER_PRICE_THRESHOLD = Number(process.env.LOWER_PRICE_THRESHOLD!);
let LAST_TRADE_TIMESTAMP_SEC = 0;
const BUY_AMOUNT_MIN = Number(process.env.BUY_AMOUNT!.split('-')[0]);
const BUY_AMOUNT_MAX = Number(process.env.BUY_AMOUNT!.split('-')[1]);


// Solana setup
const solanaConnection = new Connection(process.env.SOLANA_RPC_URL!);
const solanaWallet = createWallet(process.env.SOLANA_BUY_PRIVATE_KEY!, solanaConnection);

// Initialize the client
const client = new OKXDexClient({
    // API credentials (get from OKX Developer Portal)
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    apiPassphrase: process.env.OKX_API_PASSPHRASE!,
    projectId: process.env.OKX_PROJECT_ID!,
    // Solana configuration
    solana: {
        wallet: solanaWallet,
        computeUnits: 300000, // Optional
        maxRetries: 3 // Optional
    },
})

async function getQuote(fromTokenAddress: string, toTokenAddress: string, amount: string): Promise<{
    fromToken: TokenInfo,
    toToken: TokenInfo
}> {
    const quote = await client.dex.getQuote({
        chainIndex: '501',
        fromTokenAddress: fromTokenAddress, // SOL
        toTokenAddress: toTokenAddress, // USDC
        amount: amount, // Small amount for quote
        slippagePercent: '0.5' // 0.5% slippagePercent
    });
    return {
        fromToken: {
            address: fromTokenAddress,
            symbol: quote.data[0].fromToken.tokenSymbol,
            decimals: parseInt(quote.data[0].fromToken.decimal),
            price: quote.data[0].fromToken.tokenUnitPrice
        },
        toToken: {
            address: toTokenAddress,
            symbol: quote.data[0].toToken.tokenSymbol,
            decimals: parseInt(quote.data[0].toToken.decimal),
            price: quote.data[0].toToken.tokenUnitPrice
        }
    }
}


async function executeSwap(tokenInfo: { fromToken: TokenInfo, toToken: TokenInfo }, humanReadableAmount: number) {
    try {
        if (!process.env.SOLANA_BUY_PRIVATE_KEY) {
            throw new Error('Missing SOLANA_BUY_PRIVATE_KEY in .env file');
        }
        const rawAmount = (humanReadableAmount * Math.pow(10, tokenInfo.fromToken.decimals)).toString();
        console.log("--------------------------------------------------------------------------------");
        console.log(`使用${tokenInfo.fromToken.symbol}购买${tokenInfo.toToken.symbol}`);
        console.log(`金额: ${humanReadableAmount} ${tokenInfo.fromToken.symbol}`);
        console.log(`Amount in base units: ${rawAmount}`);
        console.log(`预估美元价格: $${(humanReadableAmount * parseFloat(tokenInfo.fromToken.price)).toFixed(2)}`);
        // Execute the swap
        console.log("开始执行买入操作...");
        const swapResult = await client.dex.executeSwap({
            chainIndex: '501', // Solana chain ID
            fromTokenAddress: tokenInfo.fromToken.address,
            toTokenAddress: tokenInfo.toToken.address,
            amount: rawAmount,
            slippagePercent: '0.5', // 0.5% slippagePercent
            userWalletAddress: process.env.SOLANA_BUY_WALLET_ADDRESS!
        });
        console.log("买入操作成功，交易详情如下:");
        console.log(JSON.stringify(swapResult, null, 2));
        console.log("--------------------------------------------------------------------------------");
        LAST_TRADE_TIMESTAMP_SEC = Math.floor(Date.now() / 1000);
        return swapResult;
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error executing swap:', error.message);
            // API errors include details in the message
            if (error.message.includes('API Error:')) {
                const match = error.message.match(/API Error: (.*)/);
                if (match) console.error('API Error Details:', match[1]);
            }
        }
        console.error("执行买入操作失败:", error);
    }
}

function checkTradeInterval(): boolean {
    const currentTimestampSec = Math.floor(Date.now() / 1000);
    const randomInterval = Math.floor(Math.random() * (TRADE_INTERVAL_SEC_MAX - TRADE_INTERVAL_SEC_MIN + 1)) + TRADE_INTERVAL_SEC_MIN;
    if (currentTimestampSec - LAST_TRADE_TIMESTAMP_SEC < randomInterval) {
        console.log(`距离上次交易时间不足设定的间隔${randomInterval}秒，跳过此次交易`);
        return false;
    }
    return true;
}

// 保留6位随机小树点
function randomBuyAmount(): number {
    const randomAmount = Math.random() * (BUY_AMOUNT_MAX - BUY_AMOUNT_MIN) + BUY_AMOUNT_MIN;
    return Math.floor(randomAmount * 1e6) / 1e6;
}

new Scheduler(async () => {
    let tokenInfo: { fromToken: TokenInfo, toToken: TokenInfo };
    try {
        tokenInfo = await getQuote(SOL_ADDRESS, TARGET_ADDRESS, '1000000')
        console.log("目标token美元价格为:", tokenInfo.toToken.price);
    } catch (error) {
        console.error("获取目标token价格失败:", error);
        return;
    }
    if (Number(tokenInfo.toToken.price) < LOWER_PRICE_THRESHOLD && checkTradeInterval()) {
        console.log(`价格低于设定的下限${LOWER_PRICE_THRESHOLD}，执行买入操作`);
        await executeSwap({fromToken: tokenInfo.fromToken, toToken: tokenInfo.toToken}, randomBuyAmount());
        return
    }
}, 5 * 1000)
    .start()
    .catch();
