import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { CONTACT_ENQUIRY_STATUS_VALUES, DATABASE_TABLE_NAMES, type ContactEnquiryStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";

export class ContactEnquiry extends Model<InferAttributes<ContactEnquiry>, InferCreationAttributes<ContactEnquiry>> {
  declare id: CreationOptional<number>;
  declare enquiry_number: CreationOptional<string>;
  declare name: string;
  declare email: string;
  declare phone: string | null;
  declare subject: string;
  declare message: string;
  declare status: CreationOptional<ContactEnquiryStatus>;
  declare admin_note: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeContactEnquiryTable(sequelize: Sequelize): typeof ContactEnquiry {
  if (isModelInitialized(ContactEnquiry)) {
    return ContactEnquiry;
  }

  ContactEnquiry.init(
    {
      id: numericPrimaryKeyAttribute(),
      enquiry_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(160), allowNull: false, validate: { notEmpty: true, len: [1, 160] } },
      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
        validate: { isEmail: true, notEmpty: true, len: [3, 190] },
        set(value: string) {
          this.setDataValue("email", value.trim().toLowerCase());
        }
      },
      phone: { type: DataTypes.STRING(32), allowNull: true, validate: { len: [0, 32] } },
      subject: { type: DataTypes.STRING(190), allowNull: false, validate: { notEmpty: true, len: [1, 190] } },
      message: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      status: { type: DataTypes.ENUM(...CONTACT_ENQUIRY_STATUS_VALUES), allowNull: false, defaultValue: "new" },
      admin_note: { type: DataTypes.TEXT, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.contactEnquiries, "ContactEnquiry", false),
      indexes: [
        { unique: true, fields: ["enquiry_number"], name: "contact_enquiries_enquiry_number_unique" },
        { fields: ["status", "created_at"], name: "contact_enquiries_status_created_at_idx" },
        { fields: ["email"], name: "contact_enquiries_email_idx" },
        { fields: ["created_at"], name: "contact_enquiries_created_at_idx" }
      ]
    }
  );



  return ContactEnquiry;
}