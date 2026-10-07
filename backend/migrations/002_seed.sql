-- 002_seed.sql
-- Starting master data. Everything here can be renamed, extended or deactivated from Settings.

INSERT INTO accounts (name, kind, sort_order) VALUES
    ('Bank Account', 'bank',        1),
    ('Credit Card',  'credit_card', 10),
    ('Cash Wallet',  'cash',        20);

INSERT INTO categories (name, kind, description, sort_order) VALUES
    ('Food & Groceries',                     'expense', 'Supermarket, vegetables, milk, provisions', 1),
    ('Dining Out / Food Delivery',           'expense', 'Restaurants, Swiggy, Zomato', 2),
    ('Rent / Housing',                       'expense', 'Rent, maintenance charges', 3),
    ('Utilities',                            'expense', 'Electricity, water, gas', 4),
    ('Mobile & Internet',                    'expense', 'Recharges, broadband, DTH', 5),
    ('Local Commute',                        'expense', 'Cab, auto, metro, bus', 6),
    ('Travel & Trips',                       'expense', 'Holidays, outstation tickets, hotels', 7),
    ('Vehicle',                              'expense', 'Fuel, servicing, vehicle insurance, PUC, parking', 8),
    ('Clothing & Accessories',               'expense', 'Clothes, footwear, bags', 9),
    ('Electronics & Gadgets',                'expense', 'Phones, laptops, appliances', 10),
    ('Health & Medical',                     'expense', 'Doctor, medicines, tests', 11),
    ('Education & Professional Development', 'expense', 'Fees, books, courses, certifications', 12),
    ('Entertainment & Subscriptions',        'expense', 'Movies, OTT, apps', 13),
    ('Household & Maintenance',              'expense', 'Repairs, cleaning, domestic help', 14),
    ('Insurance (Life / Health)',            'expense', 'Life and health premiums', 15),
    ('EMI / Loan',                           'expense', 'Loan EMIs', 16),
    ('Gifts & Donations',                    'expense', 'Gifts, temple, charity', 17),
    ('Personal Care',                        'expense', 'Salon, grooming', 18),
    ('Family Support',                       'expense', 'Money for parents and relatives', 19),
    ('Bank Charges & Fees',                  'expense', 'Card fees, interest, late fees, penalties', 20),
    ('Miscellaneous',                        'expense', 'Anything else', 99);

INSERT INTO categories (name, kind, description, sort_order) VALUES
    ('Salary',        'income', NULL, 1),
    ('Variable Pay',  'income', NULL, 2),
    ('Bonus',         'income', NULL, 3),
    ('Reimbursement', 'income', NULL, 4),
    ('Bank Interest', 'income', NULL, 5),
    ('Other Income',  'income', NULL, 99);

INSERT INTO categories (name, kind, description, is_system, sort_order) VALUES
    ('Investment Returns', 'income', 'Gain or loss on Redeem entries (filled automatically)', 1, 50);

INSERT INTO payment_modes (name, sort_order) VALUES
    ('UPI', 1), ('Credit Card', 2), ('Debit Card', 3), ('Cash', 4), ('Net Banking', 5);
