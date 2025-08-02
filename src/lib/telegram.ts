import axios from 'axios';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const formatNumber = (num: number) => 
  new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(num);

export const shortAdd = (str: string) => 
  str.length <= 7 ? str : str.slice(0, 4) + '...' + str.slice(-4);

export const escp = (msg: string) => {
  if (!msg) return '';
  return msg
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
};

export async function sendTelegramMessage(message: string): Promise<boolean> {
  try {
    const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
      console.error('Telegram credentials missing');
      return false;
    }
    
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    // Добавляем таймаут и обработку сетевых ошибок
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }, {
      timeout: 5000 // 5 секунд таймаут
    });
    
    return response.status === 200;
  } catch (error: any) {
    // Улучшенная обработка ошибок
    let errorDetails = 'Unknown error';
    
    if (error.response) {
      // Сервер ответил с кодом ошибки
      errorDetails = `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      // Запрос был сделан, но ответа не было
      errorDetails = 'No response received';
    } else {
      // Ошибка при настройке запроса
      errorDetails = error.message;
    }
    
    console.error('Telegram error:', errorDetails);
    return false;
  }
}

export async function getIpInfo(): Promise<{ IP: string, ISO2: string }> {
  try {
    const response = await axios.get('https://ipapi.co/json/');
    return {
      IP: response.data.ip || '??',
      ISO2: response.data.country || '??'
    };
  } catch (error) {
    return { IP: '??', ISO2: '??' };
  }
}