# Payment Method Options

Northflow payment options are merchant/provider-account capabilities, not a global method catalog.

## Current method types

Use these method types:

```txt
qris
virtual_account
ewallet
card
retail_outlet
manual
other
```

## Filtering model

Northflow filters options by:

- merchant
- provider account
- currency
- amount range
- method status

The merchant frontend should display the options returned by Northflow through the merchant backend. Do not hardcode unsupported methods in the merchant frontend.

## Provider account methods

Each provider account declares or syncs available methods. A method can be active, disabled, or unsupported. Disabled and unsupported methods should not be offered to customers.

## Old names not to use

Do not use old names such as `bank_transfer` or `qr_code` as recommended method types. If a provider adapter has a provider-specific method code, store that as provider metadata or provider method code while using the supported Northflow method type.
