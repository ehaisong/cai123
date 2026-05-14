UPDATE payment_channels
SET config = jsonb_set(config, '{platformPublicKey}', to_jsonb('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqd1AGRTTQKE62yvgVhB4UnfbSnm+DRw2ClQQO3i+NrZnxrno45NXZRiyjFf12p1FkVU9T6FfqFBDjmpN+KtgoKjTDmhTUzcfri9W/Y7jzxLA6alFe6NQtDG8KadFjee03ULn7WYhzaaW+DP4VoDD91d0sqK1OycyUMiv6xbBLFZ17WRFpYaZbKl7ri579+jJbVuF89UDLfrSj5GLbOwKsdk1Zuy1Pe4cITuznNJoT8aqCDAbn+9EmtE4Jgv8tqdZKwvzgQ9AMcOlb92e2ps3J5pq/Z2WSu4o+ut6x0KwoG2YHyX14or6l+0s34WmzAHlDPf0rFzh151sdskIspvKJQIDAQAB'::text)),
    updated_at = now()
WHERE provider = '3ypay' AND code = '3ypay';