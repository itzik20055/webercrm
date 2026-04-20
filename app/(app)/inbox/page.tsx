import { redirect } from "next/navigation";

export default function InboxIndexRedirect() {
  redirect("/queue");
}
