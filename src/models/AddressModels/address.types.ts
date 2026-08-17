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
  // Exposed as number|null in the public API (normalized from the string DECIMAL the driver returns).
  latitude: number | null;
  longitude: number | null;
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
  // Both must be present together or both absent. Never one without the other.
  latitude?: number;
  longitude?: number;
};

export type CreateAddressInput = AddressFieldsInput & {
  label?: string;
  isDefault?: boolean;
};

// UpdateAddressInput extends the partial address fields with explicit coordinate-clearing support.
// The coordinate pair is represented as a discriminated triple:
//   - both omitted (undefined/undefined) → preserve existing
//   - both valid numbers → set/update
//   - both null → explicitly clear
//   - mixed (one null, one number, or one present one absent) → Zod rejects before this type is used
export type UpdateAddressInput = Partial<AddressFieldsInput> & {
  label?: string;
  isDefault?: boolean;
  // null is the explicit clear signal; undefined means "no change requested"
  latitude?: number | null;
  longitude?: number | null;
};
