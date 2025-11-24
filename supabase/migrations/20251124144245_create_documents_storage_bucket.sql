/*
  # Create Documents Storage Bucket

  1. Storage Setup
    - Create 'documents' bucket for storing PDF files
    - Set public access for document viewing
    - Add policies for read/write access
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
CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

-- Create policy to allow public uploads (for guest uploads if needed)
CREATE POLICY "Anyone can upload documents"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'documents');

-- Create policy to allow authenticated users (admins) to delete
CREATE POLICY "Authenticated users can delete documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');

-- Create policy to allow authenticated users (admins) to update
CREATE POLICY "Authenticated users can update documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');
