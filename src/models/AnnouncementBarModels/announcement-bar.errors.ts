import { ApplicationError } from "../../utils/application-error.js";

export class AnnouncementBarError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({ statusCode, code, message, isOperational: true });
    this.name = "AnnouncementBarError";
  }
}

export class AnnouncementBarItemNotFoundError extends AnnouncementBarError {
  public constructor() {
    super("ANNOUNCEMENT_BAR_ITEM_NOT_FOUND", "Announcement bar item not found.", 404);
    this.name = "AnnouncementBarItemNotFoundError";
  }
}

export class InvalidAnnouncementBarItemIdError extends AnnouncementBarError {
  public constructor() {
    super("INVALID_ANNOUNCEMENT_BAR_ITEM_ID", "Announcement bar item ID must be a positive integer.", 400);
    this.name = "InvalidAnnouncementBarItemIdError";
  }
}

export class InvalidAnnouncementBarItemDataError extends AnnouncementBarError {
  public constructor(message: string = "Invalid announcement bar item data.") {
    super("INVALID_ANNOUNCEMENT_BAR_ITEM_DATA", message, 400);
    this.name = "InvalidAnnouncementBarItemDataError";
  }
}
