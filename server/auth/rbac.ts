export type Role = "owner" | "admin" | "finance" | "viewer";

export type Permission =
  | "read"
  | "links:write"
  | "widgets:write"
  | "settings:write"
  | "team:write"
  | "developers:write"
  | "money:write"
  | "wallet:write";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(["read", "links:write", "widgets:write", "settings:write", "team:write", "developers:write", "money:write", "wallet:write"]),
  admin: new Set(["read", "links:write", "widgets:write", "settings:write", "team:write", "developers:write"]),
  finance: new Set(["read", "money:write"]),
  viewer: new Set(["read"]),
};

export const can = (role: Role, permission: Permission) => MATRIX[role].has(permission);
export const isRole = (value: string): value is Role => value in MATRIX;
