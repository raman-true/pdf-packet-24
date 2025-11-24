import { PDFDocument, PDFPage, rgb, StandardFonts, PageSizes } from 'pdf-lib'

export interface Env {
  // Define your environment variables here
}

interface ProjectData {
  projectName: string;
  submittedTo: string;
  preparedBy: string;
  date: string;
  projectNumber?: string;
  emailAddress: string;
  phoneNumber: string;
  product: string;
  productType?: string;
  status: {
    forReview: boolean;
    forApproval: boolean;
    forRecord: boolean;
    forInformationOnly: boolean;
  };
  submittalType: {
    tds: boolean;
    threePartSpecs: boolean;
    testReportIccEsr5194: boolean;
    testReportIccEsl1645: boolean;
    fireAssembly: boolean;
    fireAssembly01: boolean;
    fireAssembly02: boolean;
    fireAssembly03: boolean;
    msds: boolean;
    leedGuide: boolean;
    installationGuide: boolean;
    warranty: boolean;
    samples: boolean;
    other: boolean;
    otherText?: string;
  };
}

interface DocumentRequest {
  id: string;
  name: string;
  url: string;
  type: string;
  fileData?: string;
}

interface GeneratePacketRequest {
  projectData: ProjectData;
  documents: DocumentRequest[];
  selectedDocumentNames?: string[];
  allAvailableDocuments?: string[];
}

interface DocumentSection {
  name: string;
  type: string;
  startPage: number;
  pageCount: number;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (request.method === 'POST' && new URL(request.url).pathname === '/generate-packet') {
      try {
        if (!request.body) {
          return new Response(
            JSON.stringify({ error: 'No request body provided' }),
            { status: 400, headers: corsHeaders }
          )
        }

        let requestData: GeneratePacketRequest
        try {
          requestData = await request.json()
          if (!requestData.projectData) {
            throw new Error('Missing required field: projectData')
          }
          requestData.documents = requestData.documents || []
        } catch (error) {
          return new Response(
            JSON.stringify({ 
              error: 'Invalid JSON payload',
              details: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 400, headers: corsHeaders }
          )
        }

        const { projectData, documents, selectedDocumentNames = [], allAvailableDocuments = [] } = requestData

        try {
          console.log(`Generating packet for: ${projectData.projectName || 'Untitled Project'}`)
          console.log(`Processing ${documents.length} documents`)

          const finalPdf = await PDFDocument.create()

          let submittalFormPageCount = 0

try {
  const templatePdf = await loadAndFillTemplate(projectData, selectedDocumentNames, allAvailableDocuments)
  const submittalFormPages = await finalPdf.copyPages(templatePdf, templatePdf.getPageIndices())
  submittalFormPages.forEach(page => finalPdf.addPage(page))
  submittalFormPageCount = submittalFormPages.length
  console.log(`Added ${submittalFormPages.length} pages from submittal form`)
} catch (templateError) {
  console.error('Error loading template:', templateError)
  await addErrorPage(finalPdf, 'Template Error', 'Failed to load template. Using blank document.')
  submittalFormPageCount = 1
}

try {
  await addProductInfoPage(finalPdf, projectData)
} catch (productInfoError) {
  console.error('Error adding product info:', productInfoError)
  await addErrorPage(finalPdf, 'Product Info', 'Failed to add product information.')
}

const submittalAndProductInfoPageCount = finalPdf.getPageCount()

// Insert Table of Contents after submittal form and product info
const tocPageNumber = submittalAndProductInfoPageCount + 1
const tocPage = await createTableOfContents(finalPdf, [], tocPageNumber)
finalPdf.insertPage(submittalAndProductInfoPageCount, tocPage)


          const documentSections: DocumentSection[] = []
          let currentPageNumber = finalPdf.getPageCount() + 1

          for (const doc of documents) {
            try {
              const sectionStartPage = currentPageNumber
              await addSectionDivider(finalPdf, doc.name, doc.type)
              currentPageNumber++

              if (doc.fileData) {
                try {
                  const binaryString = atob(doc.fileData)
                  const bytes = new Uint8Array(binaryString.length)
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i)
                  }
                  const sourcePdf = await PDFDocument.load(bytes.buffer)
                  const pageIndices = sourcePdf.getPageIndices()
                  const pages = await finalPdf.copyPages(sourcePdf, pageIndices)
                  pages.forEach(page => finalPdf.addPage(page))
                  currentPageNumber += pages.length

                  documentSections.push({
                    name: doc.name,
                    type: doc.type,
                    startPage: sectionStartPage,
                    pageCount: pages.length + 1
                  })
                } catch (docError) {
                  console.error(`Error processing document ${doc.name}:` , docError)
                  await addErrorPage(finalPdf, doc.name, 'Failed to process document')
                  currentPageNumber++
                }
              } else if (doc.url) {
                try {
                  const pdfBytes = await fetchPDF(doc.url)
                  if (pdfBytes) {
                    const sourcePdf = await PDFDocument.load(pdfBytes)
                    const pageIndices = sourcePdf.getPageIndices()
                    const pages = await finalPdf.copyPages(sourcePdf, pageIndices)
                    pages.forEach(page => finalPdf.addPage(page))
                    currentPageNumber += pages.length

                    documentSections.push({
                      name: doc.name,
                      type: doc.type,
                      startPage: sectionStartPage,
                      pageCount: pages.length + 1
                    })
                  } else {
                    throw new Error('Failed to fetch document from URL')
                  }
                } catch (urlError) {
                  console.error(`Error processing document from URL ${doc.name}:`, urlError)
                  await addErrorPage(finalPdf, doc.name, 'Failed to load document from URL')
                  currentPageNumber++
                }
              }
            } catch (error) {
              console.error(`Error adding document ${doc.name}:`, error)
              await addErrorPage(finalPdf, doc.name, 'Failed to add document')
              currentPageNumber++
            }
          }

          // Update Table of Contents with actual document sections
          const updatedTocPage = await createTableOfContents(finalPdf, documentSections, tocPageNumber)
          finalPdf.setPage(submittalAndProductInfoPageCount, updatedTocPage)

          await addSelectivePageNumbers(
            finalPdf,
            finalPdf.getPageCount() - documentSections.length,
            documentSections
          )

          const pdfBytes = await finalPdf.save()
          console.log(`Packet generated successfully: ${pdfBytes.length} bytes`)

          return new Response(pdfBytes, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${(projectData.projectName || 'packet').replace(/[^a-z0-9]/gi, '_')}.pdf"`,
              'Content-Length': pdfBytes.length.toString(),
            }
          })

        } catch (error) {
          console.error('Error generating PDF:', error)
          return new Response(
            JSON.stringify({ 
              error: 'Failed to generate packet',
              details: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 500, headers: corsHeaders }
          )
        }

      } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
          JSON.stringify({ 
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
          }),
          { status: 500, headers: corsHeaders }
        )
      }
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: corsHeaders }
    )
  },
}

async function fetchPDF(url: string): Promise<ArrayBuffer | null> {
  try {
    // Convert relative URL to properly encoded GitHub raw URL
    let fullUrl = url
    if (!url.startsWith('http')) {
      // Remove leading slash if present
      const cleanPath = url.startsWith('/') ? url.substring(1) : url
      // Properly encode the URL components
      const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, '/')
      fullUrl = `https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/${encodedPath}`
    }

    console.log(`Fetching PDF from: ${fullUrl}`)

    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'PDF-Packet-Generator/1.0',
      }
    })

    if (!response.ok) {
      console.error(`Failed to fetch PDF: ${response.status} ${response.statusText}`)
      console.error(`URL attempted: ${fullUrl}`)
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    console.log(`PDF fetched successfully: ${arrayBuffer.byteLength} bytes`)
    return arrayBuffer
  } catch (error) {
    console.error(`Error fetching PDF from ${url}:`, error)
    return null
  }
}

async function loadAndFillTemplate(projectData: ProjectData, selectedDocumentNames: string[], allAvailableDocuments: string[]): Promise<PDFDocument> {
  try {
    // Fetch the template PDF from GitHub
    const templateUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/PDF-TEMPLATE/Submittal%20Form_Floor%20Panels.pdf'
    console.log('Fetching template PDF from:', templateUrl)

    const response = await fetch(templateUrl, {
      headers: {
        'User-Agent': 'PDF-Packet-Generator/1.0',
      }
    })

    if (!response.ok) {
      console.error(`Failed to fetch template: ${response.status} ${response.statusText}`)
      // Fallback to creating a custom cover page
      const pdf = await PDFDocument.create()
      await addCoverPage(pdf, projectData, selectedDocumentNames, allAvailableDocuments)
      return pdf
    }

    const templateBytes = await response.arrayBuffer()
    console.log(`Template fetched successfully: ${templateBytes.byteLength} bytes`)

    // Load the template PDF
    const pdfDoc = await PDFDocument.load(templateBytes)

    // Get the form from the template
    const form = pdfDoc.getForm()
    const fields = form.getFields()

    console.log(`Template has ${fields.length} form fields`)
    fields.forEach(field => {
      console.log(`Field: ${field.getName()} - Type: ${field.constructor.name}`)
    })

    // Fill in the form fields
    try {
      // Try to fill fields by their names (common field names in PDF forms)
      const fieldMappings = [
        { names: ['Submitted To', 'submittedTo', 'submitted_to'], value: projectData.submittedTo },
        { names: ['Project Name', 'projectName', 'project_name'], value: projectData.projectName },
        { names: ['Project Number', 'projectNumber', 'project_number'], value: projectData.projectNumber || '' },
        { names: ['Prepared By', 'preparedBy', 'prepared_by'], value: projectData.preparedBy },
        { names: ['Email', 'email', 'emailAddress', 'Email Address'], value: projectData.emailAddress },
{ names: ['Phone', 'phone', 'phoneNumber', 'Phone Number'], value: projectData.phoneNumber },

        { names: ['Date', 'date'], value: projectData.date },
      ]

      fieldMappings.forEach(mapping => {
        for (const fieldName of mapping.names) {
          try {
            const field = form.getTextField(fieldName)
            if (field) {
              field.setText(mapping.value)
              console.log(`Set field ${fieldName} to: ${mapping.value}`)
              break
            }
          } catch (e) {
            // Field doesn't exist or isn't a text field, try next name
          }
        }
      })

      // Handle checkboxes for Status/Action
      const statusCheckboxes = [
        { names: ['For Review', 'forReview', 'for_review'], value: projectData.status.forReview },
        { names: ['For Approval', 'forApproval', 'for_approval'], value: projectData.status.forApproval },
        { names: ['For Record', 'forRecord', 'for_record'], value: projectData.status.forRecord },
        { names: ['For Information Only', 'forInformationOnly', 'for_information_only'], value: projectData.status.forInformationOnly },
      ]

      statusCheckboxes.forEach(mapping => {
        for (const fieldName of mapping.names) {
          try {
            const checkbox = form.getCheckBox(fieldName)
            if (checkbox) {
              if (mapping.value) {
                checkbox.check()
              } else {
                checkbox.uncheck()
              }
              console.log(`Set checkbox ${fieldName} to: ${mapping.value}`)
              break
            }
          } catch (e) {
            // Field doesn't exist or isn't a checkbox, try next name
          }
        }
      })

      // Handle checkboxes for Submittal Type
      const submittalCheckboxes = [
        { names: ['TDS', 'tds'], value: projectData.submittalType.tds },
        { names: ['3-Part Specs', '3PartSpecs', 'threePartSpecs'], value: projectData.submittalType.threePartSpecs },
        { names: ['Test Report ICC-ESR 5194', 'testReportIccEsr5194'], value: projectData.submittalType.testReportIccEsr5194 },
        { names: ['Test Report ICC-ESL 1645', 'testReportIccEsl1645'], value: projectData.submittalType.testReportIccEsl1645 },
        { names: ['Fire Assembly', 'fireAssembly'], value: projectData.submittalType.fireAssembly },
        { names: ['Fire Assembly 01', 'fireAssembly01'], value: projectData.submittalType.fireAssembly01 },
        { names: ['Fire Assembly 02', 'fireAssembly02'], value: projectData.submittalType.fireAssembly02 },
        { names: ['Fire Assembly 03', 'fireAssembly03'], value: projectData.submittalType.fireAssembly03 },
        { names: ['MSDS', 'msds', 'Material Safety Data Sheet'], value: projectData.submittalType.msds },
        { names: ['LEED Guide', 'leedGuide'], value: projectData.submittalType.leedGuide },
        { names: ['Installation Guide', 'installationGuide'], value: projectData.submittalType.installationGuide },
        { names: ['Warranty', 'warranty'], value: projectData.submittalType.warranty },
        { names: ['Samples', 'samples'], value: projectData.submittalType.samples },
        { names: ['Other', 'other'], value: projectData.submittalType.other },
      ]

      submittalCheckboxes.forEach(mapping => {
        for (const fieldName of mapping.names) {
          try {
            const checkbox = form.getCheckBox(fieldName)
            if (checkbox) {
              if (mapping.value) {
                checkbox.check()
              } else {
                checkbox.uncheck()
              }
              console.log(`Set checkbox ${fieldName} to: ${mapping.value}`)
              break
            }
          } catch (e) {
            // Field doesn't exist or isn't a checkbox, try next name
          }
        }
      })

      // Flatten the form to make it non-editable
      form.flatten()

    } catch (fillError) {
      console.warn('Error filling form fields:', fillError)
      console.log('Template will be used as-is without filling fields')
    }

    return pdfDoc

  } catch (error) {
    console.error('Error loading template PDF:', error)
    // Fallback: create a custom cover page
    console.log('Falling back to custom cover page')
    const pdf = await PDFDocument.create()
    await addCoverPage(pdf, projectData, selectedDocumentNames, allAvailableDocuments)
    return pdf
  }
}

async function addCoverPage(pdf: PDFDocument, projectData: ProjectData, selectedDocumentNames: string[], allAvailableDocuments: string[]) {
  const page = pdf.addPage(PageSizes.Letter);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Colors - NexGen Brand Colors (#00A3CA)
  const nexgenBlue = rgb(0, 0.637, 0.792); // #00A3CA - NexGen brand blue
  const darkGray = rgb(0.13, 0.13, 0.13); // #212121
  const mediumGray = rgb(0.27, 0.27, 0.27); // #444445
  const lightBlue = rgb(0.9, 0.97, 0.98); // Light blue tint for form backgrounds
  const borderGray = rgb(0.7, 0.7, 0.7);
  const headerDark = rgb(0.078, 0.078, 0.078); // #141414 - Dark header bar

  // Dark header bar at the top (full width, 80px height - reduced size)
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: headerDark,
  });

  // NEXGEN Logo Header - White logo at specified position
  try {
    const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png';
    const logoResponse = await fetch(logoUrl);
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer();
      const logoImage = await pdf.embedPng(logoBytes);
      // Reduced logo size - aligned with section text
      const logoWidth = 100;
      const logoHeight = 15;
      
      page.drawImage(logoImage, {
        x: 50,
        y: height - 45 - (logoHeight / 2) + 5, // Adjusted for 80px header
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      // Fallback to text if logo can't be loaded (white text for dark header)
      page.drawText('NEXGEN', {
        x: 50,
        y: height - 45,
        size: 18,
        font: boldFont,
        color: rgb(1, 1, 1), // White text
      });
    }
  } catch (error) {
    console.warn('Failed to load logo, using text fallback:', error);
    // Fallback to text if logo can't be loaded (white text for dark header)
    page.drawText('NEXGEN', {
      x: 50,
      y: height - 45,
      size: 18,
      font: boldFont,
      color: rgb(1, 1, 1), // White text
    });
  }

  // Section identifier (top right) - White text on dark header
  const sectionText = 'SECTION 06 16 26';
  const sectionWidth = font.widthOfTextAtSize(sectionText, 10);
  page.drawText(sectionText, {
    x: width - 145,
    y: height - 45,
    size: 10,
    font: boldFont,
    color: rgb(1, 1, 1), // White text
  });

  // Title - Dynamic based on product type (styled text OUTSIDE the dark header box)
  // Color: #181819, Font: Regular (reduced boldness), Size: 18px, Line height: 100%, Letter spacing: -2%
  const titleColor = rgb(0.094, 0.094, 0.098); // #181819
  const isStructuralFloor = projectData.productType === 'structural-floor';
  
  if (isStructuralFloor) {
  page.drawText('MAXTERRA® MgO Non-Combustible Structural', {
      x: 55,
      y: height - 147,
      size: 18,
      font: font, // Regular font (less bold)
      color: titleColor,
      lineHeight: 18, // 100% line height
  });
  page.drawText('Floor Panels Submittal Form', {
      x: 55,
      y: height - 167,
      size: 18,
      font: font, // Regular font (less bold)
      color: titleColor,
      lineHeight: 18, // 100% line height
    });
  } else {
    // Underlayment
    page.drawText('MAXTERRA® MgO Non-Combustible', {
      x: 55,
      y: height - 147,
      size: 18,
      font: font, // Regular font (less bold)
      color: titleColor,
      lineHeight: 18, // 100% line height
    });
    page.drawText('Underlayment Panels Submittal Form', {
      x: 55,
      y: height - 167,
      size: 18,
      font: font, // Regular font (less bold)
      color: titleColor,
      lineHeight: 18, // 100% line height
    });
  }

  // Form fields start position (aligned with title)
  let currentY = height - 210;
  const labelX = 55; // Same as title alignment
  const valueX = 155; // Moved 50px more left (was 205, now 155)
  const fieldHeight = 22; // Further reduced height to match image
  const fieldWidth = width - valueX - 55;
  const fieldSpacing = 4; // Reduced gap between fields

  // Helper function to draw form field
  const drawFormField = (label: string, value: string, y: number) => {
    // Label text - Bold, black text (same style as Status / Action)
    page.drawText(label, {
      x: labelX,
      y: y + 6,
      size: 10,
      font: boldFont, // Changed to bold font
      color: darkGray, // Same color as Status / Action
    });

    // Value background box (light gray) - smaller height
    page.drawRectangle({
      x: valueX,
      y: y,
      width: fieldWidth,
      height: fieldHeight,
      color: rgb(0.95, 0.95, 0.95), // Light gray #F2F2F2
      borderColor: rgb(0.9, 0.9, 0.9),
      borderWidth: 0.5,
    });

    // Value text - smaller size
    page.drawText(value || '', {
      x: valueX + 10,
      y: y + 6,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });
  };

  // Draw form fields with spacing
  drawFormField('Submitted To', projectData.submittedTo, currentY);
  currentY -= (fieldHeight + fieldSpacing);

  drawFormField('Project Name', projectData.projectName, currentY);
  currentY -= (fieldHeight + fieldSpacing);

  drawFormField('Project Number', projectData.projectNumber || '', currentY);
  currentY -= (fieldHeight + fieldSpacing);

  drawFormField('Prepared By', projectData.preparedBy, currentY);
  currentY -= (fieldHeight + fieldSpacing);

  drawFormField('Email Address', projectData.emailAddress, currentY);
currentY -= (fieldHeight + fieldSpacing);

drawFormField('Phone Number', projectData.phoneNumber, currentY);
currentY -= (fieldHeight + fieldSpacing);


  drawFormField('Date', projectData.date, currentY);
  currentY -= (fieldHeight + 15);

  // Status/Action section with checkboxes
  page.drawText('Status / Action', {
    x: labelX,
    y: currentY,
    size: 10,
    font: boldFont,
    color: darkGray,
  });
  currentY -= 10; // Reduced from 20 to 10 (moved 10px up)

  const checkboxSize = 12;
  const checkboxSpacing = 130;
  let checkboxX = valueX;

  const drawCheckbox = (label: string, checked: boolean, x: number, y: number) => {
    // Checkbox with light gray background (same as value fields)
    page.drawRectangle({
      x: x,
      y: y,
      width: checkboxSize,
      height: checkboxSize,
      color: rgb(0.95, 0.95, 0.95), // Light gray background like value fields
      borderColor: rgb(0.9, 0.9, 0.9),
      borderWidth: 0.5,
    });

    // Checkbox check mark if checked
    if (checked) {
      // X mark
      page.drawText('X', {
        x: x + 3,
        y: y + 2,
        size: 9,
        font: boldFont,
        color: nexgenBlue,
      });
    }

    // Label
    page.drawText(label, {
      x: x + checkboxSize + 5,
      y: y + 2,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });
  };

  // Move checkboxes 3px up
  drawCheckbox('For Review', projectData.status.forReview, checkboxX, currentY + 3);
  drawCheckbox('For Approval', projectData.status.forApproval, checkboxX + checkboxSpacing, currentY + 3);
  currentY -= 18;
  drawCheckbox('For Record', projectData.status.forRecord, checkboxX, currentY + 3);
  drawCheckbox('For Information Only', projectData.status.forInformationOnly, checkboxX + checkboxSpacing, currentY + 3);

  currentY -= 30;

  // Submittal Type section - DYNAMIC: Show ALL category documents, check only selected ones
  page.drawText('Submittal Type (check all that apply):', {
    x: labelX,
    y: currentY,
    size: 15, // Increased from 10 to 15 (5px increase)
    font: boldFont,
    color: darkGray,
  });
  currentY -= 20;

  // Helper function to add header to new page
  const addHeaderToPage = async (newPage: PDFPage) => {
    const { width: pgWidth, height: pgHeight } = newPage.getSize();
    
    // Dark header bar at the top
    newPage.drawRectangle({
      x: 0,
      y: pgHeight - 80,
      width: pgWidth,
      height: 80,
      color: headerDark,
    });

    // NEXGEN Logo
    try {
      const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png';
      const logoResponse = await fetch(logoUrl);
      if (logoResponse.ok) {
        const logoBytes = await logoResponse.arrayBuffer();
        const logoImage = await pdf.embedPng(logoBytes);
        const logoWidth = 100;
        const logoHeight = 15;
        
        newPage.drawImage(logoImage, {
          x: 50,
          y: pgHeight - 45 - (logoHeight / 2) + 5,
          width: logoWidth,
          height: logoHeight,
        });
      }
    } catch (error) {
      console.warn('Failed to load logo on continuation page');
    }

    // Section identifier
    const sectionText = 'SECTION 06 16 26';
    newPage.drawText(sectionText, {
      x: pgWidth - 145,
      y: pgHeight - 45,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    // Continuation title
    newPage.drawText('Submittal Form (continued)', {
      x: 55,
      y: pgHeight - 110,
      size: 14,
      font: boldFont,
      color: titleColor,
    });
  };

  // Draw ALL available documents from the category - aligned with "Submittal Type" label
  // Add dynamic page breaks when running out of space
  const minYForContent = 100; // Reduced from 150 to 100 - allow content closer to footer
  let currentPage = page;
  const checkboxLineSpacing = 14; // Reduced from 16 to 14 for tighter spacing

  if (allAvailableDocuments && allAvailableDocuments.length > 0) {
    for (let i = 0; i < allAvailableDocuments.length; i++) {
      const docName = allAvailableDocuments[i];
      
      // Check if we need a new page
      if (currentY < minYForContent) {
        // Add new page
        currentPage = pdf.addPage(PageSizes.Letter);
        await addHeaderToPage(currentPage);
        currentY = height - 140; // Reset Y position for new page
      }

      // Check if this document is selected
      const isSelected = selectedDocumentNames?.includes(docName) || false;
      
      // Draw checkbox on current page
      const checkboxY = currentY;
      currentPage.drawRectangle({
        x: labelX,
        y: checkboxY,
        width: checkboxSize,
        height: checkboxSize,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: rgb(0.9, 0.9, 0.9),
        borderWidth: 0.5,
      });

      if (isSelected) {
        currentPage.drawText('X', {
          x: labelX + 3,
          y: checkboxY + 2,
          size: 9,
          font: boldFont,
          color: nexgenBlue,
        });
      }

      currentPage.drawText(docName, {
        x: labelX + checkboxSize + 5,
        y: checkboxY + 2,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      });

      currentY -= checkboxLineSpacing; // Use tighter spacing
    }
  } else if (selectedDocumentNames && selectedDocumentNames.length > 0) {
    // Fallback: if allAvailableDocuments not provided, show selected ones
    for (let i = 0; i < selectedDocumentNames.length; i++) {
      const docName = selectedDocumentNames[i];
      
      // Check if we need a new page
      if (currentY < minYForContent) {
        currentPage = pdf.addPage(PageSizes.Letter);
        await addHeaderToPage(currentPage);
        currentY = height - 140;
      }

      // Draw checkbox on current page
      const checkboxY = currentY;
      currentPage.drawRectangle({
        x: labelX,
        y: checkboxY,
        width: checkboxSize,
        height: checkboxSize,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: rgb(0.9, 0.9, 0.9),
        borderWidth: 0.5,
      });

      currentPage.drawText('X', {
        x: labelX + 3,
        y: checkboxY + 2,
        size: 9,
        font: boldFont,
        color: nexgenBlue,
      });

      currentPage.drawText(docName, {
        x: labelX + checkboxSize + 5,
        y: checkboxY + 2,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      });

      currentY -= checkboxLineSpacing; // Use tighter spacing
    }
  } else {
    // No documents at all
    currentPage.drawText('No documents available', {
      x: labelX,
      y: currentY,
      size: 9,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });
    currentY -= checkboxLineSpacing;
  }

  currentY -= 10;

  // Check if we have space for Product section and footer
  if (currentY < minYForContent + 100) {
    currentPage = pdf.addPage(PageSizes.Letter);
    await addHeaderToPage(currentPage);
    currentY = height - 140;
  }

  // Product section
  currentPage.drawText('Product:', {
    x: labelX,
    y: currentY,
    size: 10,
    font: boldFont,
    color: darkGray,
  });
  currentPage.drawText(projectData.product, {
    x: valueX,
    y: currentY,
    size: 10,
    font: font,
    color: darkGray,
  });

  // Footer section - always on last page
  const footerY = 120;
  currentPage.drawText('NEXGEN® Building Products, LLC', {
    x: labelX,
    y: footerY,
    size: 9,
    font: boldFont,
    color: darkGray,
  });
  currentPage.drawText('1504 Manhattan Ave West, #300 Brandon, FL 34205', {
    x: labelX,
    y: footerY - 12,
    size: 8,
    font: font,
    color: mediumGray,
  });
  currentPage.drawText('(727) 634-5534', {
    x: labelX,
    y: footerY - 24,
    size: 8,
    font: font,
    color: mediumGray,
  });
  currentPage.drawText('Technical Support: support@nexgenbp.com', {
    x: labelX,
    y: footerY - 36,
    size: 8,
    font: font,
    color: mediumGray,
  });

  // Version footer
  const versionText = 'Version 1.0 October 2025 © 2025 NEXGEN Building Products';
  const versionWidth = font.widthOfTextAtSize(versionText, 7);
  currentPage.drawText(versionText, {
    x: width - versionWidth - 50,
    y: 50,
    size: 7,
    font: font,
    color: mediumGray,
  });
}

async function addDividerPage(pdf: PDFDocument, documentName: string, documentType: string, pageNumber: number) {
  const page = pdf.addPage(PageSizes.Letter)
  const { width, height } = page.getSize()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)

  const nexgenBlue = rgb(0, 0.637, 0.792); // #00A3CA - NexGen brand blue
  const darkGray = rgb(0.08, 0.08, 0.08); // #141414 - Dark background
  const orange = rgb(0.93, 0.39, 0.15); // #EE6325 - Orange gradient start
  const white = rgb(1, 1, 1); // White text

  // Black background for entire page
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: height,
    color: rgb(0, 0, 0),
  })

  // Top dark gray header bar (height: 96.75)
  page.drawRectangle({
    x: 0,
    y: height - 96.75,
    width: width,
    height: 96.75,
    color: darkGray,
  })

  // NEXGEN Logo in top header (using blue/cyan logo on dark background)
  try {
    const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png';
    const logoResponse = await fetch(logoUrl);
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer();
      const logoImage = await pdf.embedPng(logoBytes);
      const logoHeight = 30;
      const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
      
      page.drawImage(logoImage, {
        x: 15,
        y: height - 70,
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      // Fallback text
      page.drawText('NEXGEN', {
        x: 15,
        y: height - 55,
        size: 24,
        font: boldFont,
        color: nexgenBlue,
      });
    }
  } catch (error) {
    // Fallback text
    page.drawText('NEXGEN', {
      x: 15,
      y: height - 55,
      size: 24,
      font: boldFont,
      color: nexgenBlue,
    });
  }

  page.drawText('Package Section Divider', {
    x: 15,
    y: height - 82,
    size: 9,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  })

  // Orange gradient bar (height: 9) - simulating gradient with solid orange
  page.drawRectangle({
    x: 0,
    y: height - 105.75,
    width: width,
    height: 9,
    color: orange,
  })

  // White content area
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: height - 105.75,
    color: white,
  })

  // "Section Divider" text (top: 134px from top, left: 74px based on your design)
  const contentStartY = height - 180;
  page.drawText('Section Divider', {
    x: 74,
    y: contentStartY,
    size: 32,
    font: font,
    color: rgb(0, 0, 0),
  })

  // Document name (LEED Credit Guide / Technical Data Sheet style)
  page.drawText(documentName, {
    x: 74,
    y: contentStartY - 50,
    size: 40,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  // Page number at bottom
  page.drawText(`Page ${pageNumber}`, {
    x: 42,
    y: 60,
    size: 10,
    font: font,
    color: rgb(0.4, 0.4, 0.4),
  })

  // Footer with copyright (matching design)
  const footerText = '© 2025 NEXGEN Building Products';
  const footerWidth = font.widthOfTextAtSize(footerText, 9);
  page.drawText(footerText, {
    x: width - footerWidth - 42,
    y: 40,
    size: 9,
    font: font,
    color: white,
  })

  // Blue footer bar at bottom
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: 30,
    color: nexgenBlue,
  })

  page.drawText(footerText, {
    x: width / 2 - footerWidth / 2,
    y: 12,
    size: 9,
    font: font,
    color: white,
  })
}

// Helper function to add error pages
async function addErrorPage(pdf: PDFDocument, documentName: string, errorMessage: string) {
  const page = pdf.addPage(PageSizes.Letter)
  const { width, height } = page.getSize()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Error header
  page.drawText('DOCUMENT ERROR', {
    x: 50,
    y: height - 100,
    size: 16,
    font: boldFont,
    color: rgb(0.8, 0.2, 0.2),
  })

  // Document name
  page.drawText(documentName, {
    x: 50,
    y: height - 150,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  // Error message
  page.drawText(`Error: ${errorMessage}`, {
    x: 50,
    y: height - 180,
    size: 12,
    font: font,
    color: rgb(0.6, 0.2, 0.2),
  })

  // Instructions
  page.drawText('Please contact support if this error persists.', {
    x: 50,
    y: height - 220,
    size: 10,
    font: font,
    color: rgb(0.4, 0.4, 0.4),
  })
}

async function addPageNumbers(pdf: PDFDocument) {
  const pages = pdf.getPages()
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  pages.forEach((page, index) => {
    const { width } = page.getSize()
    const pageNumber = index + 1

    page.drawText(`${pageNumber}`, {
      x: width - 50,
      y: 30,
      size: 10,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    })
  })
}

async function addProductInfoPage(pdf: PDFDocument, projectData: ProjectData) {
  let page = pdf.addPage(PageSizes.Letter)
  const { width, height } = page.getSize()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)

  const isStructuralFloor = projectData.productType === 'structural-floor'
  const headerDark = rgb(0.078, 0.078, 0.078) // #141414 - Dark header bar
  
  // Dark header bar at the top (full width, 80px height - reduced size)
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: headerDark,
  })

  // NEXGEN Logo in header - White logo (same as cover page)
  try {
    const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png';
    const logoResponse = await fetch(logoUrl);
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer();
      const logoImage = await pdf.embedPng(logoBytes);
      const logoWidth = 100;
      const logoHeight = 15;
      
      page.drawImage(logoImage, {
        x: 50,
        y: height - 45 - (logoHeight / 2) + 5,
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      page.drawText('NEXGEN', {
        x: 50,
        y: height - 45,
        size: 18,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
    }
  } catch (error) {
    page.drawText('NEXGEN', {
      x: 50,
      y: height - 45,
      size: 18,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
  }

  // Section identifier (top right)
  const sectionText = isStructuralFloor ? 'SECTION 06 16 23' : 'SECTION 06 16 26';
  page.drawText(sectionText, {
    x: width - 145,
    y: height - 45,
    size: 10,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  // No title text - removed as requested
  
  const margin = 50
  const contentWidth = width - (margin * 2)
  let currentY = height - 100 // Start below the header
  const lineHeight = 14 // Increased from 12 to 14 for better spacing
  const sectionSpacing = 20 // Increased from 18 to 20
  const paragraphSpacing = 15 // Increased from 10 to 15

  // Helper function to add header to new pages
  const addHeaderToPage = async (newPage: any) => {
    // Dark header bar
    newPage.drawRectangle({
      x: 0,
      y: height - 80,
      width: width,
      height: 80,
      color: headerDark,
    });

    // Logo
    try {
      if (logoImageBytes) {
        const newLogoImage = await pdf.embedPng(logoImageBytes);
        const logoWidth = 100;
        const logoHeight = 15;
        
        newPage.drawImage(newLogoImage, {
          x: 50,
          y: height - 45 - (logoHeight / 2) + 5,
          width: logoWidth,
          height: logoHeight,
        });
      }
    } catch (error) {
      newPage.drawText('NEXGEN', {
        x: 50,
        y: height - 45,
        size: 18,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
    }

    // Section identifier
    const sectionText = isStructuralFloor ? 'SECTION 06 16 23' : 'SECTION 06 16 26';
    newPage.drawText(sectionText, {
      x: width - 145,
      y: height - 45,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
  }

  // Helper function to draw text with word wrap
  const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, fontSize: number, fontType: any): number => {
    const words = text.split(' ')
    let line = ''
    let yPos = y

    for (const word of words) {
      const testLine = line + word + ' '
      const testWidth = fontType.widthOfTextAtSize(testLine, fontSize)
      
      if (testWidth > maxWidth && line !== '') {
        page.drawText(line.trim(), { x, y: yPos, size: fontSize, font: fontType, color: rgb(0, 0, 0) })
        line = word + ' '
        yPos -= lineHeight
      } else {
        line = testLine
      }
    }
    
    if (line.trim() !== '') {
      page.drawText(line.trim(), { x, y: yPos, size: fontSize, font: fontType, color: rgb(0, 0, 0) })
      yPos -= lineHeight
    }
    
    return yPos
  }

  // Draw section heading - Manrope style with #4D4C4C color
  const drawSectionHeading = (heading: string, y: number): number => {
    page.drawText(heading, { 
      x: margin, 
      y, 
      size: 11, 
      font: boldFont, // Semibold weight
      color: rgb(0.302, 0.298, 0.298) // #4D4C4C
    })
    return y - sectionSpacing
  }

  // STRUCTURAL FLOOR CONTENT
  if (isStructuralFloor) {
    // Title
    currentY = drawSectionHeading('What Are MAXTERRA® MgO Non-Combustible Structural Floor Panels', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels are high-performance subfloor panels with tongue and groove edges engineered to deliver fire resistance, acoustical performance, structural performance, and long-term durability in a single product.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Applications
    currentY = drawSectionHeading('Applications', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels are engineered and tested for use on wood and cold-formed steel framing across a wide range of structural subfloor applications, delivering superior structural performance, fire resistance, acoustic control, and long-term durability. Designed to replace traditional plywood, OSB, wet-laid gypsum underlayment, or concrete deck systems, MAXTERRA® MgO Non-Combustible Structural Floor Panels provide a stronger, more dimensionally stable platform that meets the demands of multifamily, hospitality, modular, and other high-performance construction projects. MAXTERRA® MgO Non-Combustible Structural Floor Panels are recognized by the International Code Council Evaluation Service (ICC-ES) under Evaluation Report ESR-5194, Listing Report ESL-1645, and Underwriters Laboratories (UL) under Report R41539 confirming compliance for use in fire-rated and sound-rated floor assemblies across Types I–V construction.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Skip-the-Gyp
    currentY = drawSectionHeading('Skip-the-Gyp™ & Ditch-the-Deck™ Advantage', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels are engineered as a single-layer system that delivers a faster, cleaner, and more efficient installation process while achieving code-required STC/IIC sound when installed as part of tested floor/ceiling assemblies. Unlike gypsum cement underlayment or costly and complex pan-and-pour systems, MAXTERRA® panels eliminate the need for a separate wet-floor trades, door header or base plate modifications, added project oversight, and lengthy cure times that can delay or halt construction schedules. The result is a streamlined, single-trade solution that ensures reliable fire, sound, and structural performance across all types of high-demand projects.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Continue on second page if needed
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Availability
    currentY = drawSectionHeading('Availability', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels are available through NEXGEN Building Products authorized distribution partners nationwide. For purchasing information, technical support, or to locate a distributor near you, visit www.nexgenbp.com/find-rep-or-distributor or contact NEXGEN Building Products directly +1(727)620-3334.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Sound Attenuation (keep on same page as Availability)
    currentY = drawSectionHeading('Sound Attenuation', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels have been evaluated in floor/ceiling assemblies for Sound Transmission Class (STC) in accordance with ASTM E90, and Impact Insulation Class (IIC) in accordance with ASTM E492. Evaluated assemblies are detailed in ICC-ES Listing Report ESL-1645.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Please visit NEXGEN Building Products resource page to find most up-to-date assemblies:', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Fire Resistance (keep on same page as Sound Attenuation)
    currentY = drawSectionHeading('Fire Resistance', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Non-Combustible Structural Floor Panels have been evaluated in floor/ceiling assemblies for fire-resistance in accordance with ASTM E119 (Standard Test Methods for Fire Tests of Building Construction and Materials) and ANSI/UL 263 (Fire Tests of Building Construction and Materials). Evaluated assemblies include: UL H501, UL H505, UL H515, UL H524, UL L502, UL L525, UL L528, & UL M500.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Please visit NEXGEN Building Products resource page to find most up-to-date assemblies:', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Check for page break
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Floor Covering
    currentY = drawSectionHeading('Floor Covering', currentY)
    currentY = drawWrappedText('Many types of finished floor coverings can be installed over MAXTERRA® MgO Non-Combustible Structural Floor Panels. Before applying any floor covering, always check the flooring manufacturer\'s installation requirements and confirm compatibility with the substrate. Follow all requirements for primers, adhesives, mortars, self-levelers, underlayment, and related materials. Floor coverings commonly installed over MAXTERRA® panels include (but are not limited to): Engineered wood flooring, Vinyl, LVP, LVT, Carpet, & Tile (tile requires an additional tile backer underlayment). Refer to the MAXTERRA® MgO Non-Combustible Structural Floor Installation Guide for complete information regarding finished flooring installation: www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Check for page break
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Fasteners
    currentY = drawSectionHeading('Fasteners', currentY)
    currentY = drawWrappedText('Fasteners used with MAXTERRA® MgO Non-Combustible Structural Floor Panels must be code-recognized and inherently resistant to corrosion, or factory-coated for corrosion resistance (electro-galvanized or better). Use only approved fasteners suitable for the specific assembly and substrate to ensure long-term performance.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Refer to the MAXTERRA® MgO Non-Combustible Structural Floor Installation Guide for complete information regarding fastener schedules: www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Continue on second page if needed
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Bottom section - Remarks and Approvals (Specifications section removed)
    currentY -= 20
    
    currentY = drawSectionHeading('Remarks', currentY)
    page.drawRectangle({ x: margin, y: currentY - 40, width: contentWidth, height: 35, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    currentY -= 50

    currentY = drawSectionHeading('Approvals', currentY)
    currentY -= 5
    page.drawText('Architect/Engineer Review', { x: margin, y: currentY, size: 9, font: boldFont, color: rgb(0, 0, 0) })
    currentY -= 15
    
    // Approval checkboxes
    const checkboxSize = 10
    const checkboxY = currentY
    page.drawRectangle({ x: margin, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Approved', { x: margin + 15, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 80, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Revise & Resubmit', { x: margin + 95, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 200, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Approval as Noted', { x: margin + 215, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 330, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Rejected', { x: margin + 345, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    currentY -= 25
    page.drawText('Signature ________________________', { x: margin, y: currentY, size: 9, font, color: rgb(0, 0, 0) })
    page.drawText('Date ____________', { x: margin + 250, y: currentY, size: 9, font, color: rgb(0, 0, 0) })
  } 
  // UNDERLAYMENT CONTENT
  else {
    // Title
    currentY = drawSectionHeading('What Is MAXTERRA® MgO Fire- And Water-Resistant Underlayment', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels are engineered to deliver superior fire resistance, acoustic performance, and dimensional stability for today\'s demanding job sites. Manufactured from magnesium oxide (MgO) with reinforcing glass fiber mesh, MAXTERRA® panels provide a high-density, fire-resistant solution. They are designed for use as flooring underlayment over wood structural panels, serving as a durable replacement for other underlayment products such as wet-laid gypsum in both sound- and fire-rated assemblies.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Applications
    currentY = drawSectionHeading('Applications', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels are engineered and tested for use across a wide range of flooring underlayment applications, delivering proven performance in sound control, fire resistance, and structural durability. MAXTERRA® provides a more durable and dimensionally stable solution and is ideally suited for multifamily, hospitality, modular, and other high-performance construction projects.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels are recognized by the International Code Council Evaluation Service (ICC-ES) under Evaluation Report ESR-5192 and Listing Report ESL-1645.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Skip-the-Gyp
    currentY = drawSectionHeading('Skip-the-Gyp™ Advantage', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels are engineered to achieve code-required STC/IIC sound ratings without the need for gypsum cement underlayment or sound mats, when installed as part of tested floor/ceiling assemblies. Unlike gypsum cement, MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels eliminate the need for a separate gypsum underlayment trade, additional sill plates, modifications to door headers, and additional project oversight – all while avoiding long cure times, cleanup, and callbacks that can delay or halt construction schedules. The result is a faster, cleaner, and more efficient installation process with reliable performance.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Continue on second page if needed
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Availability
    currentY = drawSectionHeading('Availability', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels are available through NEXGEN Building Products authorized distribution partners nationwide. For purchasing information, technical support, or to locate a distributor near you, visit www.nexgenbp.com/find-rep-or-distributor or contact NEXGEN Building Products directly +1(727)620-3334.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Sound Attenuation (keep on same page as Availability)
    currentY = drawSectionHeading('Sound Attenuation', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels have been evaluated in floor/ceiling assemblies for Sound Transmission Class (STC) in accordance with ASTM E90, and Impact Insulation Class (IIC) in accordance with ASTM E492. Evaluated assemblies for underlayment are detailed in Report ESL-1645.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Please visit NEXGEN Building Products resource page to find most up-to-date assemblies:', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Fire Resistance (keep on same page as Sound Attenuation)
    currentY = drawSectionHeading('Fire Resistance', currentY)
    currentY = drawWrappedText('MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels have been evaluated in floor/ceiling assemblies for fire-resistance in accordance with ASTM E119 (Standard Test Methods for Fire Tests of Building Construction and Materials) and ANSI/UL 263 (Fire Tests of Building Construction and Materials). UL L501, UL L502, UL L525, UL L528, UL L570, UL L602, & UL M500.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Please visit NEXGEN Building Products resource page to find most up-to-date assemblies:', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('www.nexgenbp.com/resources', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Check for page break
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Floor Covering
    currentY = drawSectionHeading('Floor Covering', currentY)
    currentY = drawWrappedText('Many types of finished floor coverings can be installed over MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels. Before applying any floor covering, always check the flooring manufacturer\'s installation requirements and confirm compatibility with the substrate. Follow all requirements for primers, adhesives, mortars, feathering compounds, and related materials.', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Floor coverings commonly installed over MAXTERRA® panels include (but are not limited to): Carpet, Engineered wood flooring, Vinyl, LVP, LVT, & Tile (tile requires an additional tile backer underlayment).', margin, currentY, contentWidth, 9, font)
    currentY -= 8
    currentY = drawWrappedText('Refer to the MAXTERRA® Underlayment Installation Manual for complete information regarding finished flooring installation.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Check for page break
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Fasteners
    currentY = drawSectionHeading('Fasteners', currentY)
    currentY = drawWrappedText('Fasteners used with MAXTERRA® MgO Fire- And Water-Resistant Underlayment Panels must be code-recognized and inherently resistant to corrosion, or factory-coated for corrosion resistance (electro-galvanized or better). Use only approved fasteners suitable for the specific assembly and substrate to ensure long-term performance. Refer to the MAXTERRA® MgO Fire- And Water-Resistant Underlayment Installation Manual for complete information regarding fastener schedules.', margin, currentY, contentWidth, 9, font)
    currentY -= paragraphSpacing

    // Continue on second page if needed
    if (currentY < 300) {
      page = pdf.addPage(PageSizes.Letter)
      await addHeaderToPage(page)
      currentY = height - 110
    }

    // Bottom section - Remarks and Approvals (Specifications section removed)
    currentY -= 20
    
    currentY = drawSectionHeading('Remarks', currentY)
    page.drawRectangle({ x: margin, y: currentY - 40, width: contentWidth, height: 35, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    currentY -= 50

    currentY = drawSectionHeading('Approvals', currentY)
    currentY -= 5
    page.drawText('Architect/Engineer Review', { x: margin, y: currentY, size: 9, font: boldFont, color: rgb(0, 0, 0) })
    currentY -= 15
    
    // Approval checkboxes
    const checkboxSize = 10
    const checkboxY = currentY
    page.drawRectangle({ x: margin, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Approved', { x: margin + 15, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 80, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Revise & Resubmit', { x: margin + 95, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 200, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Approval as Noted', { x: margin + 215, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    page.drawRectangle({ x: margin + 330, y: checkboxY, width: checkboxSize, height: checkboxSize, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    page.drawText('Rejected', { x: margin + 345, y: checkboxY + 2, size: 8, font, color: rgb(0, 0, 0) })
    
    currentY -= 25
    page.drawText('Signature ________________________', { x: margin, y: currentY, size: 9, font, color: rgb(0, 0, 0) })
    page.drawText('Date ____________', { x: margin + 250, y: currentY, size: 9, font, color: rgb(0, 0, 0) })
  }
}

// TABLE OF CONTENTS PAGE
async function createTableOfContents(pdf: PDFDocument, sections: DocumentSection[], tocPageNumber: number): Promise<PDFPage> {
  const page = pdf.addPage(PageSizes.Letter)
  const { width, height } = page.getSize()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const headerDark = rgb(0.078, 0.078, 0.078) // #141414

  // Dark header bar (80px height)
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: headerDark,
  })

  // Logo (same as cover page)
  try {
    const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png'
    const logoResponse = await fetch(logoUrl)
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer()
      const logoImage = await pdf.embedPng(logoBytes)
      page.drawImage(logoImage, {
        x: 50,
        y: height - 45 - (15 / 2) + 5,
        width: 100,
        height: 15,
      })
    }
  } catch (error) {
    page.drawText('NEXGEN', {
      x: 50,
      y: height - 45,
      size: 18,
      font: boldFont,
      color: rgb(1, 1, 1),
    })
  }

  // Title in header
  page.drawText('Table of Contents', {
    x: width - 180,
    y: height - 45,
    size: 11,
    font: boldFont,
    color: rgb(1, 1, 1),
  })

  // Content area - start well below the dark header (80px high)
  let currentY = height - 110 // Increased from 100 to 110 to give more space
  const margin = 50
  const lineHeight = 25

  // "Table of Contents" heading on the page
  page.drawText('Table of Contents', {
    x: margin,
    y: currentY,
    size: 18,
    font: boldFont,
    color: rgb(0.094, 0.094, 0.098), // #181819 - same as main titles
  })
  currentY -= 30 // Space after heading

  sections.forEach((section) => {
    if (currentY < 100) {
      return // Would need pagination for very long TOCs
    }

    // Document name
    const maxNameWidth = width - 200
    let displayName = section.name
    const nameWidth = font.widthOfTextAtSize(displayName, 11)
    if (nameWidth > maxNameWidth) {
      // Truncate if too long
      while (font.widthOfTextAtSize(displayName + '...', 11) > maxNameWidth && displayName.length > 10) {
        displayName = displayName.substring(0, displayName.length - 1)
      }
      displayName += '...'
    }

    page.drawText(displayName, {
      x: margin,
      y: currentY,
      size: 11,
      font: font,
      color: rgb(0, 0, 0),
    })

    // Dotted line
    const dots = '.'
    const dotsStartX = margin + font.widthOfTextAtSize(displayName, 11) + 10
    const dotsEndX = width - 100
    const dotsWidth = font.widthOfTextAtSize(dots, 11)
    let currentX = dotsStartX
    while (currentX < dotsEndX) {
      page.drawText(dots, {
        x: currentX,
        y: currentY,
        size: 11,
        font: font,
        color: rgb(0.6, 0.6, 0.6),
      })
      currentX += dotsWidth + 3
    }

    // Page number
    page.drawText(`Page ${section.startPage}`, {
      x: width - 90,
      y: currentY,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    })

    currentY -= lineHeight
  })

  return page
}

// SECTION DIVIDER PAGE
async function addSectionDivider(pdf: PDFDocument, documentName: string, documentType: string): Promise<void> {
  const page = pdf.addPage(PageSizes.Letter)
  const { width, height } = page.getSize()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const headerDark = rgb(0.078, 0.078, 0.078) // #141414

  // Dark header bar (80px height)
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: headerDark,
  })

  // Logo (same as cover page)
  try {
    const logoUrl = 'https://raw.githubusercontent.com/karthikeyanasha24/pdf-packet-6/main/public/image-white.png'
    const logoResponse = await fetch(logoUrl)
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer()
      const logoImage = await pdf.embedPng(logoBytes)
      page.drawImage(logoImage, {
        x: 50,
        y: height - 45 - (15 / 2) + 5,
        width: 100,
        height: 15,
      })
    }
  } catch (error) {
    page.drawText('NEXGEN', {
      x: 50,
      y: height - 45,
      size: 18,
      font: boldFont,
      color: rgb(1, 1, 1),
    })
  }

  // Section title in header
  page.drawText('Document Section', {
    x: width - 180,
    y: height - 45,
    size: 11,
    font: font,
    color: rgb(1, 1, 1),
  })

  // Main content - Document name centered
  const centerY = height / 2

  // Document name (large, centered) - displayed only once
  // Document name (large, centered) - displayed only once
const nameSize = 40
const nameWidth = boldFont.widthOfTextAtSize(documentName, nameSize)
page.drawText(documentName, {
  x: (width - nameWidth) / 2,
  y: centerY,
  size: nameSize,
  font: boldFont,
  color: rgb(0.13, 0.13, 0.13),
})

// Decorative line below name
const lineWidth = 200
page.drawLine({
  start: { x: (width - lineWidth) / 2, y: centerY - 30 },
  end: { x: (width + lineWidth) / 2, y: centerY - 30 },
  thickness: 2,
  color: rgb(0, 0.637, 0.792), // NexGen blue
})

}

// SELECTIVE PAGE NUMBERING (only submittal form, product info, TOC, and section dividers)
async function addSelectivePageNumbers(pdf: PDFDocument, submittalAndProductInfoPageCount: number, sections: DocumentSection[]): Promise<void> {
  const pages = pdf.getPages()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  
  let globalPageNumber = 1
  
  // 1. Add page numbers to Submittal Form + Product Info pages
  for (let i = 0; i < submittalAndProductInfoPageCount && i < pages.length; i++) {
    const page = pages[i]
    const { width } = page.getSize()
    page.drawText(`${globalPageNumber}`, {
      x: width - 50,
      y: 30,
      size: 10,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    })
    globalPageNumber++
  }
  
  // 2. Add page number to Table of Contents (inserted at submittalAndProductInfoPageCount position)
  if (pages.length > submittalAndProductInfoPageCount) {
    const tocPage = pages[submittalAndProductInfoPageCount]
    const { width } = tocPage.getSize()
    tocPage.drawText(`${globalPageNumber}`, {
      x: width - 50,
      y: 30,
      size: 10,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    })
    globalPageNumber++
  }
  
  // 3. Add page numbers to Section Dividers only (not the actual documents)
  let currentIndex = submittalAndProductInfoPageCount + 1 // After TOC
  sections.forEach(section => {
    if (currentIndex < pages.length) {
      // Add page number to section divider
      const dividerPage = pages[currentIndex]
      const { width } = dividerPage.getSize()
      dividerPage.drawText(`${globalPageNumber}`, {
        x: width - 50,
        y: 30,
        size: 10,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      })
      globalPageNumber++
      
      // Skip the actual document pages (don't add page numbers to them)
      currentIndex += section.pageCount
    }
  })
}
