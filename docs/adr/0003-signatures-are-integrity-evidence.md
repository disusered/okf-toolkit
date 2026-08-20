# Treat signatures as optional integrity evidence

Ed25519 bundle signatures are an optional package over exact bundle bytes.
Signature validity does not create an OKF `verified` event, raise a trust tier,
or decide whether a signing key is trusted. Consumer profiles retain those
decisions.
