export interface PaymentRequest {
  amount: number;
  reference: string;
  phoneNumber?: string; // required for MOMO/AIRTEL
}

export interface PaymentResult {
  success: boolean;
  providerRef: string;
  message: string;
}

export interface PaymentProvider {
  charge(req: PaymentRequest): Promise<PaymentResult>;
}
