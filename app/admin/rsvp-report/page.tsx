import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import RsvpReportClient from "./RsvpReportClient";

export const dynamic = "force-dynamic";

export default function RsvpReportPage() {
  if (!isAuthed()) redirect("/admin/login");
  return <RsvpReportClient />;
}
