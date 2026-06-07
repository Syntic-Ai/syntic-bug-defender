"""
py-app-fixture — minimal Flask app with planted security bugs.
"""
import subprocess
from flask import Flask, request, jsonify

app = Flask(__name__)


# PLANTED BUG 1: SQL Injection via f-string interpolation
def get_user(conn, user_id: str):
    # Never do this — attacker can pass: "1 OR 1=1 --"
    query = f"SELECT * FROM users WHERE id = {user_id}"
    # In real code: cursor.execute(query)
    print(f"Running query: {query}")
    return query


# PLANTED BUG 2: Command Injection via subprocess with unsanitised user input
@app.route("/ping")
def ping():
    host = request.args.get("host", "localhost")
    # Attacker can pass: host=127.0.0.1; cat /etc/passwd
    result = subprocess.run(
        f"ping -c 1 {host}",
        shell=True,
        capture_output=True,
        text=True,
    )
    return jsonify({"stdout": result.stdout, "stderr": result.stderr})


@app.route("/user")
def user_route():
    user_id = request.args.get("id", "1")
    query = get_user(None, user_id)
    return jsonify({"query": query})


if __name__ == "__main__":
    app.run(debug=True)
