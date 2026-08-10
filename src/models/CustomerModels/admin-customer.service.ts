import { Op, type WhereOptions } from "sequelize";
import { User, Address } from "../../database/tables/index.js";
import type {
  CustomerListResponse,
  ListCustomersQuery,
  SafeAddressJSON,
  SafeCustomerDetailJSON,
  SafeCustomerJSON
} from "./admin-customer.types.js";

function toSafeCustomerJSON(user: User): SafeCustomerJSON {
  return {
    id: user.id,
    referenceCode: user.reference_code,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    emailVerifiedAt: user.email_verified_at,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function toSafeAddressJSON(addr: Address): SafeAddressJSON {
  return {
    id: addr.id,
    fullName: addr.recipient_name,
    phone: addr.phone,
    addressLine1: addr.line_1,
    addressLine2: addr.line_2,
    city: addr.city,
    state: addr.state,
    postalCode: addr.postal_code,
    countryCode: addr.country,
    isDefault: addr.is_default
  };
}

const SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: "created_at",
  name: "name",
  lastLoginAt: "last_login_at",
  id: "id"
};

export const AdminCustomerService = {
  async listCustomers(query: ListCustomersQuery): Promise<CustomerListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereConditions: WhereOptions[] = [{ role: "customer" }];

    if (query.status) {
      whereConditions.push({ status: query.status });
    }

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      whereConditions.push({
        [Op.or]: [
          { name: { [Op.like]: searchPattern } },
          { email: { [Op.like]: searchPattern } },
          { phone: { [Op.like]: searchPattern } },
          { reference_code: { [Op.like]: searchPattern } }
        ]
      });
    }

    const sortKey = query.sort ?? "createdAt";
    const orderDirection = query.order ?? "DESC";
    const dbSortColumn = SORT_COLUMN_MAP[sortKey] ?? "created_at";

    const { rows, count } = await User.findAndCountAll({
      where: { [Op.and]: whereConditions },
      order: [[dbSortColumn, orderDirection]],
      limit,
      offset
    });

    const items = rows.map(toSafeCustomerJSON);
    const totalPages = Math.ceil(count / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        totalItems: count,
        totalPages
      }
    };
  },

  async getCustomerDetail(customerId: number): Promise<SafeCustomerDetailJSON | null> {
    const user = await User.findOne({
      where: { id: customerId, role: "customer" },
      include: [{ model: Address, as: "addresses" }]
    });

    if (!user) {
      return null;
    }

    const baseJSON = toSafeCustomerJSON(user);
    const addresses = user.addresses ? user.addresses.map(toSafeAddressJSON) : [];

    return {
      ...baseJSON,
      addresses
    };
  }
};
