import { createHash, createHmac, randomBytes } from "crypto";

export interface SelcomConfig {
  apiKey: string;
  apiSecret: string;
  vendorId: string;
  baseUrl: string; // https://apigw.selcommobile.com for production
}

export interface CreateCheckoutParams {
  orderId: string;
  amount: number;
  currency: string; // TZS, USD, KES, etc.
  buyerEmail?: string;
  buyerPhone?: string;
  buyerName?: string;
  paymentMethods: ('mpesa' | 'card' | 'bank_transfer' | 'tigopesa' | 'airtel' | 'halopesa')[];
  webhook?: string;
  redirectUrl?: string;
  cancelUrl?: string;
  expiryMinutes?: number;
}

export interface SelcomCheckoutResponse {
  success: boolean;
  checkoutUrl?: string;
  transactionId?: string;
  reference?: string;
  error?: string;
}

function mapPaymentMethodsToSelcom(methods: string[]): string[] {
  const selcomMethods: string[] = [];
  
  for (const method of methods) {
    switch (method.toLowerCase()) {
      case 'mpesa':
        selcomMethods.push('USSDPUSH');
        break;
      case 'card':
        selcomMethods.push('MASTERPASS', 'CARD');
        break;
      case 'bank_transfer':
      case 'bank':
        selcomMethods.push('BANK');
        break;
      case 'tigopesa':
        selcomMethods.push('TIGOPESA');
        break;
      case 'airtel':
        selcomMethods.push('AIRTELMONEY');
        break;
      case 'halopesa':
        selcomMethods.push('HALOPESA');
        break;
    }
  }
  
  // Default to all methods if none specified
  if (selcomMethods.length === 0) {
    return ['USSDPUSH', 'MASTERPASS', 'CARD'];
  }
  
  return [...new Set(selcomMethods)]; // Remove duplicates
}

function generateSelcomAuth(apiKey: string, apiSecret: string): { authorization: string; digestMethod: string; digest: string; timestamp: string; signedFields: string } {
  const timestamp = new Date().toISOString();
  const signedFields = `timestamp`;
  const digest = createHmac('sha256', apiSecret)
    .update(timestamp)
    .digest('base64');
  
  return {
    authorization: `SELCOM ${apiKey}`,
    digestMethod: 'HS256',
    digest,
    timestamp,
    signedFields,
  };
}

export async function createSelcomCheckout(
  config: SelcomConfig,
  params: CreateCheckoutParams
): Promise<SelcomCheckoutResponse> {
  try {
    const auth = generateSelcomAuth(config.apiKey, config.apiSecret);
    const paymentMethods = mapPaymentMethodsToSelcom(params.paymentMethods);
    
    const payload = {
      vendor: config.vendorId,
      order_id: params.orderId,
      buyer_email: params.buyerEmail || 'customer@example.com',
      buyer_name: params.buyerName || 'Customer',
      buyer_phone: params.buyerPhone || '',
      amount: params.amount,
      currency: params.currency || 'TZS',
      payment_methods: paymentMethods.join(','),
      redirect_url: params.redirectUrl || '',
      cancel_url: params.cancelUrl || '',
      webhook: params.webhook || '',
      billing_firstname: params.buyerName?.split(' ')[0] || 'Customer',
      billing_lastname: params.buyerName?.split(' ').slice(1).join(' ') || '',
      no_of_items: 1,
      expiry: params.expiryMinutes || 60,
    };

    const response = await fetch(`${config.baseUrl}/v1/checkout/create-order-minimal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth.authorization,
        'Digest-Method': auth.digestMethod,
        'Digest': auth.digest,
        'Timestamp': auth.timestamp,
        'Signed-Fields': auth.signedFields,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || data.resultcode !== '000') {
      return {
        success: false,
        error: data.message || data.result || `Selcom error: ${response.status}`,
      };
    }

    return {
      success: true,
      checkoutUrl: data.data?.[0]?.payment_gateway_url || data.gateway_url,
      transactionId: data.data?.[0]?.transid || data.transid,
      reference: data.data?.[0]?.reference || data.reference || params.orderId,
    };
  } catch (error: any) {
    console.error('Selcom checkout error:', error);
    return {
      success: false,
      error: error.message || 'Failed to create Selcom checkout',
    };
  }
}

export async function checkSelcomStatus(
  config: SelcomConfig,
  orderId: string
): Promise<{ success: boolean; status?: string; paid?: boolean; error?: string }> {
  try {
    const auth = generateSelcomAuth(config.apiKey, config.apiSecret);

    const response = await fetch(`${config.baseUrl}/v1/checkout/order-status?order_id=${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': auth.authorization,
        'Digest-Method': auth.digestMethod,
        'Digest': auth.digest,
        'Timestamp': auth.timestamp,
        'Signed-Fields': auth.signedFields,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || `Status check failed: ${response.status}` };
    }

    const status = data.data?.[0]?.payment_status || data.payment_status;
    return {
      success: true,
      status,
      paid: status === 'COMPLETED' || status === 'SUCCESSFUL',
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function getBusinessPaymentMethods(businessSettings: any): string[] {
  // Try different locations where payment methods might be stored
  const methods: string[] = [];
  
  // Check business.settings.payments.methods
  if (businessSettings?.payments?.methods && Array.isArray(businessSettings.payments.methods)) {
    methods.push(...businessSettings.payments.methods);
  }
  
  // Check business.settings.paymentMethods
  if (businessSettings?.paymentMethods && Array.isArray(businessSettings.paymentMethods)) {
    methods.push(...businessSettings.paymentMethods);
  }
  
  // Remove cash (not applicable for online payments) and dedupe
  return [...new Set(methods.filter(m => m !== 'cash'))];
}
