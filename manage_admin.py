"""Create or manage NPUTrainArena admin accounts from the server machine."""

import argparse
import getpass
import re

from database import Database, DuplicateEmail


def main():
    parser = argparse.ArgumentParser(description="Manage NPUTrainArena administrator accounts")
    parser.add_argument("action", choices=("create", "grant", "revoke", "password"))
    parser.add_argument("email", help="Administrator email address")
    parser.add_argument("--name", default="Administrator", help="Display name for a new administrator")
    args = parser.parse_args()
    email = args.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
        parser.error("Enter a valid email address.")
    database = Database()
    if args.action in {"create", "password"}:
        if args.action == "create" and not 2 <= len(args.name.strip()) <= 40:
            parser.error("Display name must be 2-40 characters.")
        password = getpass.getpass("New administrator password: ")
        confirmation = getpass.getpass("Confirm password: ")
        if password != confirmation:
            parser.error("Passwords do not match.")
        if not 12 <= len(password) <= 128:
            parser.error("Administrator password must be 12-128 characters.")
        if args.action == "create":
            try:
                database.create_admin(args.name.strip(), email, password)
            except DuplicateEmail:
                parser.error("Account already exists; use grant for an existing account.")
            print(f"{email}: admin account created")
        else:
            if not database.reset_admin_password(email, password):
                parser.error("Administrator account not found.")
            print(f"{email}: password updated and sessions revoked")
        return
    role = "admin" if args.action == "grant" else "member"
    if not database.set_user_role(email, role):
        parser.error("Account not found. Use create to add a new administrator.")
    print(f"{email}: {role}")


if __name__ == "__main__":
    main()
