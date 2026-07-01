import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import ReportClient from "./ReportClient";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  if (!isAuthed()) redirect("/admin/login");
  return <ReportClient />;
}
