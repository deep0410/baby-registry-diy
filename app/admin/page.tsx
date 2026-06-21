import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (!isAuthed()) redirect("/admin/login");
  return <AdminClient />;
}
