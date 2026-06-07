import React from "react";

interface Props {
  userBio: string; // untrusted input from the database / URL param
}

// PLANTED BUG: XSS via dangerouslySetInnerHTML with unsanitised user input
export function UserProfile({ userBio }: Props) {
  return (
    <div className="profile">
      <h2>About me</h2>
      {/* attacker can set userBio = '<img src=x onerror=alert(1)>' */}
      <div dangerouslySetInnerHTML={{ __html: userBio }} />
    </div>
  );
}

export default UserProfile;
