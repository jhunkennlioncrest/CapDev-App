/** Domain identity. Distinct from the Supabase auth record (Domain Blueprint §6.2). */
export interface Person {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  status: "invited" | "active" | "suspended" | "offboarded" | "archived";
}

export interface Session {
  person: Person;
  permissions: string[];
}
