import type { UserStatus } from "../../constants/database.constants.js";

export type ListCustomersQuery = {
  page?: number;
  limit?: number;
  search?: string | undefined;
  status?: UserStatus | undefined;
  sort?: "createdAt" | "name" | "lastLoginAt" | "id";
  order?: "ASC" | "DESC";
};

export type SafeAddressJSON = {
  id: number;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
};

export type SafeCustomerJSON = {
  id: number;
  referenceCode: string;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | string | null;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type SafeCustomerDetailJSON = SafeCustomerJSON & {
  addresses?: SafeAddressJSON[];
};

export type PaginationMeta = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
};

export type CustomerListResponse = {
  items: SafeCustomerJSON[];
  pagination: PaginationMeta;
};
