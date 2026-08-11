export type AddressJSON = {
  id: number;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AddressFieldsInput = {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
};

export type CreateAddressInput = AddressFieldsInput & {
  label?: string;
  isDefault?: boolean;
};

export type UpdateAddressInput = Partial<AddressFieldsInput> & {
  label?: string;
  isDefault?: boolean;
};
