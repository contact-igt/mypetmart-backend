import { Op } from "sequelize";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { ContactEnquiry } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { ContactEnquiryNotFoundError } from "./contact.errors.js";
import type {
  AdminContactEnquiryItem,
  CreateContactEnquiryInput,
  ListAdminContactEnquiriesQuery,
  StorefrontContactEnquiryResultJSON,
  UpdateContactEnquiryInput
} from "./contact.types.js";

export class ContactService {
  public static toAdminItem(enquiry: ContactEnquiry): AdminContactEnquiryItem {
    return {
      id: enquiry.id,
      enquiryNumber: enquiry.enquiry_number,
      name: enquiry.name,
      email: enquiry.email,
      phone: enquiry.phone,
      subject: enquiry.subject,
      orderNumber: enquiry.order_number,
      message: enquiry.message,
      status: enquiry.status,
      adminNote: enquiry.admin_note,
      createdAt: enquiry.created_at.toISOString(),
      updatedAt: enquiry.updated_at.toISOString()
    };
  }

  // Create Contact Enquiry (public, guest-accessible)
  public static async createEnquiry(input: CreateContactEnquiryInput): Promise<StorefrontContactEnquiryResultJSON> {
    return await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.contactEnquiries, t);
      const enquiryNumber = buildBusinessReference("enquiry", id);

      await ContactEnquiry.create(
        {
          id,
          enquiry_number: enquiryNumber,
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          subject: input.subject,
          order_number: input.orderNumber || null,
          message: input.message,
          status: "new",
          admin_note: null
        },
        { transaction: t }
      );

      return { success: true, enquiryNumber };
    });
  }

  public static async listAdminContactEnquiries(query: ListAdminContactEnquiriesQuery): Promise<{
    items: AdminContactEnquiryItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const whereClause: Record<string, unknown> = {};

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      whereClause[Op.or as unknown as string] = [
        { enquiry_number: { [Op.like]: term } },
        { name: { [Op.like]: term } },
        { email: { [Op.like]: term } },
        { phone: { [Op.like]: term } },
        { order_number: { [Op.like]: term } }
      ];
    }

    const { count, rows } = await ContactEnquiry.findAndCountAll({
      where: whereClause,
      order: [["created_at", "DESC"], ["id", "DESC"]],
      limit: pageSize,
      offset
    });

    return {
      items: rows.map((row) => this.toAdminItem(row)),
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  }

  public static async getAdminContactEnquiryById(id: number): Promise<AdminContactEnquiryItem> {
    const enquiry = await ContactEnquiry.findByPk(id);
    if (!enquiry) {
      throw new ContactEnquiryNotFoundError();
    }
    return this.toAdminItem(enquiry);
  }

  // Admin may update ONLY status and admin_note — the original customer
  // submission (name/email/phone/subject/orderNumber/message) remains an
  // accurate, immutable record of what was actually submitted.
  public static async updateAdminContactEnquiry(id: number, input: UpdateContactEnquiryInput): Promise<AdminContactEnquiryItem> {
    const enquiry = await ContactEnquiry.findByPk(id);
    if (!enquiry) {
      throw new ContactEnquiryNotFoundError();
    }

    if (input.status !== undefined) {
      enquiry.status = input.status;
    }
    if (input.adminNote !== undefined) {
      enquiry.admin_note = input.adminNote;
    }

    await enquiry.save();
    return this.toAdminItem(enquiry);
  }
}
