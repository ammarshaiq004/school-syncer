import { redirect } from "next/navigation";

/** Users and roles moved into the staff directory. */
export default function UsersPage() {
  redirect("/staff");
}
