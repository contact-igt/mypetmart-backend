/**
 * Centralized business reference code generator.
 */
export function buildBusinessReference(type: "customer" | "admin" | "super_admin" | "order" | "return" | "enquiry", id: number): string {
  let prefix: string;
  switch (type) {
    case "customer":
      prefix = "CUS";
      break;
    case "admin":
      prefix = "ADM";
      break;
    case "super_admin":
      prefix = "SUP";
      break;
    case "order":
      prefix = "ORD";
      break;
    case "return":
      prefix = "RET";
      break;
    case "enquiry":
      prefix = "ENQ";
      break;
    default:
      throw new Error(`Unsupported business reference type: ${type as string}`);
  }

  return `${prefix}-${String(id).padStart(6, "0")}`;
}
