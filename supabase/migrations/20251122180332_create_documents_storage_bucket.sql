/*
  # Create Admin Users, Categories, and Documents Tables

  1. New Tables
    - `admin_users`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `password_hash` (text, hashed password)
      - `is_active` (boolean)
      - `created_at` (timestamp)
      - `last_login` (timestamp)
    
    - `categories`
      - `id` (uuid, primary key)
      - `name` (text, unique)
      - `product_type` ('structural-floor' | 'underlayment')
      - `description` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `documents`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text)
      - `filename` (text)
      - `file_url` (text)
      - `size` (integer)
      - `type` (text: TDS, ESR, MSDS, LEED, Installation, Warranty, Acoustic, PartSpec)
      - `required` (boolean)
      - `products` (text array)
      - `product_type` (text: 'structural-floor' | 'underlayment')
      - `category_id` (uuid, foreign key to categories)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Public read access for documents (for non-admin users viewing available documents)
    - Admin-only write access for documents and categories
    - Admin-only access to admin_users table

  3. Indexes
    - Index on documents.product_type for filtering
    - Index on documents.category_id for foreign key queries
    - Index on admin_users.email for login lookups
*/

-- Create admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_login timestamptz
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('structural-floor', 'underlayment')),
  description text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  filename text NOT NULL,
  file_url text NOT NULL,
  size integer NOT NULL,
  type text NOT NULL CHECK (type IN ('TDS', 'ESR', 'MSDS', 'LEED', 'Installation', 'Warranty', 'Acoustic', 'PartSpec')),
  required boolean DEFAULT false,
  products text[] DEFAULT '{}',
  product_type text NOT NULL CHECK (product_type IN ('structural-floor', 'underlayment')),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for admin_users (admin only)
CREATE POLICY "Admin users can read own data"
  ON admin_users FOR SELECT
  TO authenticated
  USING (auth.uid()::text = id::text);

CREATE POLICY "Admin users can update own data"
  ON admin_users FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = id::text)
  WITH CHECK (auth.uid()::text = id::text);

-- RLS Policies for categories (public read, admin write)
CREATE POLICY "Anyone can view categories"
  ON categories FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admin can insert categories"
  ON categories FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can update categories"
  ON categories FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can delete categories"
  ON categories FOR DELETE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

-- RLS Policies for documents (public read, admin write)
CREATE POLICY "Anyone can view documents"
  ON documents FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admin can insert documents"
  ON documents FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can update documents"
  ON documents FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

CREATE POLICY "Admin can delete documents"
  ON documents FOR DELETE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND is_active = true));

-- Create indexes for performance
CREATE INDEX idx_documents_product_type ON documents(product_type);
CREATE INDEX idx_documents_category_id ON documents(category_id);
CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_categories_product_type ON categories(product_type);
/*
  # Create Documents Storage Bucket

  1. Storage Setup
    - Create 'documents' bucket for storing PDF files
    - Set public access for document viewing
*/

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy to allow public read access
CREATE POLICY "Public can read documents"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'documents');

-- Create policy to allow authenticated users (admins) to upload
CREATE POLICY "Admins can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

-- Create policy to allow authenticated users (admins) to delete
CREATE POLICY "Admins can delete documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');
