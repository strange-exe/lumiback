"""The precomputed dummy hash that keeps login timing uniform (security/passwords.py).

Argon2's verify cost comes only from the parameters stored in the hash string. The dummy is a
literal (hashing it at import cost every cold start ~60 ms), so these tests pin it to the hasher's
own parameters: if argon2-cffi's defaults change, the dummy must be regenerated, or a login for
an unknown email would answer measurably faster or slower than a wrong password.
"""

import argon2

from app.security import passwords


def test_the_dummy_hash_uses_exactly_the_hashers_parameters():
    fresh = passwords._hasher.hash(passwords._DUMMY_PASSWORD)
    assert argon2.extract_parameters(passwords._DUMMY_HASH) == argon2.extract_parameters(fresh)
    assert not passwords.needs_rehash(passwords._DUMMY_HASH)


def test_the_dummy_hash_is_a_real_argon2id_hash():
    # A malformed literal would fail fast in verify and break the timing equalisation.
    assert passwords._DUMMY_HASH.startswith("$argon2id$")
    assert passwords._hasher.verify(passwords._DUMMY_HASH, passwords._DUMMY_PASSWORD)


def test_checks_against_the_dummy_never_succeed():
    for missing in (None, "", "no-password-yet"):
        assert passwords.verify_password(missing, passwords._DUMMY_PASSWORD) is False
        assert passwords.verify_password(missing, "harbour-lantern-quietly-71") is False
    # That a missing hash still costs one Argon2 check against the dummy is tested in
    # test_student_import.py (test_accounts_without_a_password_still_cost_one_argon2_check).
