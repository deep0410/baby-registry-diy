import RsvpClient from "./RsvpClient";

export const dynamic = "force-dynamic";

export default function RsvpPage() {
  return (
    <RsvpClient
      title={process.env.NEXT_PUBLIC_REGISTRY_TITLE || "Baby Patel"}
      eventName={process.env.EVENT_NAME || "Baby Shower"}
    />
  );
}
