// src/services/pdfService.ts
import type { ProjectFormData, SelectedDocument, Document, ProductType } from '@/types'
import { documentService } from './documentService'

export class PDFService {
  private workerUrl: string

  constructor() {
    this.workerUrl = import.meta.env.VITE_WORKER_URL || 'https://pdf-packet-generator.maxterra-pdf-builder.workers.dev'
    console.log('Using Worker URL:', this.workerUrl)
  }

  async generatePacket(
    formData: Partial<ProjectFormData>,
    selectedDocuments: SelectedDocument[]
  ): Promise<Uint8Array> {
    try {
      // Filter and sort selected documents
      const sortedDocs = selectedDocuments
        .filter(doc => doc.selected)
        .sort((a, b) => a.order - b.order)

      if (sortedDocs.length === 0) {
        throw new Error('No documents selected for packet generation')
      }

      // Fetch file data for uploaded documents
      const documentsWithData = await Promise.all(
        sortedDocs.map(async (doc) => {
          try {
            let fileData = ''

            // Fetch file data from URL if available
            if (doc.document.url) {
              const response = await fetch(doc.document.url)
              if (!response.ok) {
                throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}`)
              }

              const blob = await response.blob()

              // Validate blob is a PDF
              if (blob.type && blob.type !== 'application/pdf') {
                console.warn(`Document ${doc.document.name} has unexpected type: ${blob.type}`)
              }

              const reader = new FileReader()
              fileData = await new Promise((resolve, reject) => {
                reader.onloadend = () => {
                  const base64String = reader.result as string
                  // Extract base64 data without the data:application/pdf;base64, prefix
                  const base64Data = base64String.split(',')[1] || ''
                  if (!base64Data) {
                    reject(new Error('Failed to encode document as base64'))
                  }
                  resolve(base64Data)
                }
                reader.onerror = () => reject(new Error('Failed to read document file'))
                reader.readAsDataURL(blob)
              })
            } else {
              throw new Error(`Document ${doc.document.name} has no URL`)
            }

            return {
              id: doc.id,
              name: doc.document.name || 'Unnamed Document',
              url: doc.document.url || '',
              type: doc.document.type || 'other',
              fileData: fileData || '',
            }
          } catch (error) {
            console.error(`Error processing document ${doc.document.name}:`, error)
            throw new Error(`Failed to process document: ${doc.document.name}`)
          }
        })
      )

      const selectedDocumentNames = sortedDocs.map(doc => doc.document.name || 'Unnamed Document')
      const productType = formData.productType as ProductType || 'structural-floor'

      // Get all documents of this type for the submittal form
      let allCategoryDocs: Document[] = []
      try {
        allCategoryDocs = await documentService.getDocumentsByProductType(productType)
      } catch (error) {
        console.error('Failed to fetch category documents:', error)
        // Continue with empty array if fetch fails
      }

      // Prepare request payload with all required fields and defaults
      const payload = {
        projectData: {
          // Required fields with defaults
          projectName: formData.projectName || 'Untitled Project',
          submittedTo: formData.submittedTo || 'N/A',
          preparedBy: formData.preparedBy || 'N/A',
          date: formData.date || new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          projectNumber: formData.projectNumber || 'N/A',
          emailAddress: formData.emailAddress || 'N/A',
          phoneNumber: formData.phoneNumber || 'N/A',
          product: formData.product || '3/4-in (20mm)',
          productType: productType,
          
          // Status with defaults
          status: {
            forReview: formData.status?.forReview ?? false,
            forApproval: formData.status?.forApproval ?? false,
            forRecord: formData.status?.forRecord ?? false,
            forInformationOnly: formData.status?.forInformationOnly ?? false,
          },
          
          // Submittal type with defaults
          submittalType: {
            tds: formData.submittalType?.tds ?? false,
            threePartSpecs: formData.submittalType?.threePartSpecs ?? false,
            testReportIccEsr5194: formData.submittalType?.testReportIccEsr5194 ?? false,
            testReportIccEsl1645: formData.submittalType?.testReportIccEsl1645 ?? false,
            fireAssembly: formData.submittalType?.fireAssembly ?? false,
            fireAssembly01: formData.submittalType?.fireAssembly01 ?? false,
            fireAssembly02: formData.submittalType?.fireAssembly02 ?? false,
            fireAssembly03: formData.submittalType?.fireAssembly03 ?? false,
            msds: formData.submittalType?.msds ?? false,
            leedGuide: formData.submittalType?.leedGuide ?? false,
            installationGuide: formData.submittalType?.installationGuide ?? false,
            warranty: formData.submittalType?.warranty ?? false,
            samples: formData.submittalType?.samples ?? false,
            other: formData.submittalType?.other ?? false,
            otherText: formData.submittalType?.otherText || '',
          }
        },
        
        // Process documents
        documents: documentsWithData,
        selectedDocumentNames,
        allAvailableDocuments: allCategoryDocs.map((doc: any) => doc.name).filter(Boolean)
      };

      console.log('Sending request to worker with payload:', {
        ...payload,
        documents: payload.documents.map(d => ({
          ...d,
          fileData: d.fileData ? `${d.fileData.substring(0, 30)}...` : 'No file data'
        }))
      });

      const workerResponse = await fetch(`${this.workerUrl}/generate-packet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!workerResponse.ok) {
        let errorMessage = `Worker request failed: ${workerResponse.status} ${workerResponse.statusText}`;
        try {
          const errorData = await workerResponse.json();
          errorMessage += ` - ${errorData.message || JSON.stringify(errorData)}`;
        } catch (e) {
          const text = await workerResponse.text();
          errorMessage += ` - ${text}`;
        }
        throw new Error(errorMessage);
      }

      const pdfBuffer = await workerResponse.arrayBuffer();
      if (pdfBuffer.byteLength === 0) {
        throw new Error('Received empty PDF from worker');
      }

      console.log(`PDF generated successfully: ${pdfBuffer.byteLength} bytes`);
      return new Uint8Array(pdfBuffer);

    } catch (error) {
      console.error('Error in generatePacket:', error);

      // Handle network/fetch errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          `Cannot connect to PDF Worker at ${this.workerUrl}. ` +
          'Please check your internet connection and verify the worker is accessible.'
        );
      }

      // Handle document loading errors
      if (error instanceof Error && error.message.includes('Failed to process document')) {
        throw new Error(
          'One or more documents could not be loaded. Please verify all documents are accessible and try again.'
        );
      }

      // Handle Supabase/storage errors
      if (error instanceof Error && error.message.toLowerCase().includes('bucket')) {
        throw new Error(
          'Document storage is not properly configured. Please contact support or verify your Supabase setup.'
        );
      }

      throw error instanceof Error ? error : new Error('Failed to generate PDF packet');
    }
  }

  /**
   * Preview PDF in new tab
   */
  previewPDF(pdfBytes: Uint8Array): void {
    try {
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, '_blank');
      
      if (newWindow) {
        newWindow.onload = () => URL.revokeObjectURL(url);
      } else {
        window.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 100);
      }
    } catch (error) {
      console.error('Error previewing PDF:', error);
      throw new Error('Failed to preview PDF. Please try again or download the file instead.');
    }
  }

  /**
   * Download PDF to user's device
   */
  downloadPDF(pdfBytes: Uint8Array, filename: string): void {
    try {
      if (!filename.endsWith('.pdf')) {
        filename += '.pdf';
      }
      
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      throw new Error('Failed to download PDF. Please try again.');
    }
  }
}

// Export singleton instance
export const pdfService = new PDFService();
