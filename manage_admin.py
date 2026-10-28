"""Grant or revoke NPUArena admin access from the server machine."""

import argparse

from database import Database


def main():
    parser = argparse.ArgumentParser(description="Manage NPUArena administrator accounts")
    parser.add_argument("action", choices=("grant", "revoke"))
    parser.add_argument("email", help="Email of an existing registered account")
    args = parser.parse_args()
    role = "admin" if args.action == "grant" else "member"
    if not Database().set_user_role(args.email, role):
        parser.error("Account not found. Register it first, then run this command again.")
    print(f"{args.email.strip().lower()}: {role}")


if __name__ == "__main__":
    main()
