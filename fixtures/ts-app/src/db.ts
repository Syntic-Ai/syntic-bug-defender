import { Request, Response } from "express";

// PLANTED BUG: SQL Injection — raw string concatenation with user input
export async function getUser(req: Request, res: Response) {
  const query = "SELECT * FROM users WHERE id = " + req.query.id;
  // e.g. req.query.id = "1 OR 1=1 --" would dump all users
  // In a real app this would be passed to a DB client:
  // const result = await db.query(query);
  console.log("Running query:", query);
  res.json({ query });
}

// PLANTED BUG: Hardcoded AWS Access Key literal
const AWS_ACCESS_KEY_ID = "AKIA0000000000000000";
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEYKEY";

export function getAwsConfig() {
  return { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET };
}
