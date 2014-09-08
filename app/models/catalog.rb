require 'rest_client'

class Catalog
   # get an xml report of the archives. This has 2 key parts -
   #    resource_tree.nodes
   #    resource_tree.archives.
   #
   # nodes has a list of node elements. Each has a name and may also have parent.
   # This defines the high level hierarchy
   #
   # archives has a list of archive elements. Each has a name, parent and handle.
   # Parent slots it under a node from above, and handle is used to match up facet results
   # from the next query
   #
   def self.archives

      # first, get the resource tree
      json_resources = get_resource_tree()

      # at this point, there is a tree with no counts on it. Call search to
      # get the counts for all facets
      return do_search(:archives, json_resources, nil, nil)
   end

   # get an xml report of the genres
   def self.genres
     # first, get the list of genres
     json_resources = get_genres()
     # at this point, there is a list with no counts on it. Call search to
     # get the counts for all facets
     return do_search(:genres, json_resources, nil, nil)
   end

   def self.disciplines
     # first, get the list of disciplines
     json_resources = get_disciplines()
     # at this point, there is a list with no counts on it. Call search to
     # get the counts for all facets
     return do_search(:disciplines, json_resources, nil, nil)
   end

   def self.formats
     # first, get the list of formats
     json_resources = get_formats()
     # at this point, there is a list with no counts on it. Call search to
     # get the counts for all facets
     return do_search(:formats, json_resources, nil, nil)
   end


   def self.search( query, dates )
      # first, get the resource tree
      json_resources = get_resource_tree()

      # at this point, there is a tree with no counts on it. Call search to
      # get the counts for all facets
      return do_search(:archives, json_resources, query, dates)
   end

   def self.facet(archive_handle, target_type, prior_facets, searchTerms, dates )
      # search for all  facets data for this archive
      query = "#{Settings.catalog_url}/search.xml?a=%2B"+archive_handle
      query << "&q=#{CGI.escape(searchTerms)}" if !searchTerms.nil?
      query << "&y=#{CGI.escape(dates)}" if !dates.nil?
      facets = []
      facets << "g=#{CGI.escape(prior_facets[:genre])}" if !prior_facets[:genre].nil?
      facets << "discipline=#{CGI.escape(prior_facets[:discipline])}" if !prior_facets[:discipline].nil?
      facets << "doc_type=#{CGI.escape(prior_facets[:doc_type])}" if !prior_facets[:doc_type].nil?
      facet_params = facets.join("&")
      facet_params = "&#{facet_params}" if !facet_params.empty?
      xml_resp = RestClient.get "#{query}#{facet_params}"
      data = Hash.from_xml xml_resp

      # the bit we care about is in the facets and is further narrowed by type
      data = data['search']['facets'][target_type]

      json_resources = []
      total = 0
      return [] if data.nil? || data['facet'].nil?
      if data['facet'].kind_of?(Array)
        # now, stuff this into a json datastructure for db consumption
        data['facet'].each do | facet |
           cnt = facet['count']
           total = total + cnt.to_i
           json_resources << {:name=>facet['name'].strip, :size=>facet['count'],
               :type=>"subfacet", :facet=>target_type,
               :archive_handle=>archive_handle, :other_facets=>prior_facets}
        end
      else
        cnt = data['facet']['count']
        total = total + cnt.to_i
        json_resources << {:name=>data['facet']['name'].strip, :size=>cnt,
           :type=>"subfacet", :facet=>target_type,
           :archive_handle=>archive_handle, :other_facets=>prior_facets}
      end
      #facet_json = { :name=>type, :size=>total, :children=>json_resources, :type=>"facet" }
      return json_resources
   end

   private

   def self.sum_children( children )
      sum = 0
      children.each do | child |
         if !child[:children].nil? && child[:children].length > 0
            children_sum = sum_children(child[:children])
            child[:size] = children_sum
            sum = sum + children_sum
         else
            if child[:size].nil?
               child[:size] = 0
            else
               sum = sum + child[:size].to_i
            end
         end
      end
      return sum
   end

   def self.find_resource( match_key, name, resources)
      parent = nil
      resources.each do |jr|
         if jr[match_key] == name # and jr[:type] == "archive"
            parent = jr
            break
         else
            if !jr[:children].nil? && jr[:children].count > 0
               parent = find_resource(match_key, name, jr[:children])
               if !parent.nil?
                  break
               end
            end
         end
      end

      return parent
   end

   def self.find_genre( match_key, name, resources)
     found = nil
     resources.each do |jr|
       if jr[match_key] == name and jr[:type] == "genre"
         found = jr
         break
       end
     end
     return found
   end


   def self.find_discipline( match_key, name, resources)
     found = nil
     resources.each do |jr|
       if jr[match_key] == name and jr[:type] == "discipline"
         found = jr
         break
       end
     end
     return found
   end


   def self.find_format( match_key, name, resources)
     found = nil
     resources.each do |jr|
       if jr[match_key] == name and jr[:type] == "format"
         found = jr
         break
       end
     end
     return found
   end


   def self.do_search(search_type, json_resources, query, dates)
      request = "#{Settings.catalog_url}/search.xml"
      params = []
      if !query.nil?
         params << "q=#{CGI.escape(query)}"
      end
      if !dates.nil?
         params << "y=#{CGI.escape(dates)}"
      end
      qp = params.join("&")
      request << "?" << qp if !qp.empty?
      puts "=========== #{request}"

      resp = RestClient.get request
      resp = resp.gsub(/count/, "size")
      facet_data = Hash.from_xml resp
      arc_total = facet_data['search']['total']
      facet_data = facet_data['search']['facets']

      if search_type == :archives
        # use the name from data['archive']['facet'] to find a match in data from above
        # add size to the node data. Once complete, set data as the children of archives
        facet_data['archive']['facet'].each do |facet |
           node = find_resource( :handle, facet['name'], json_resources)
           if node.nil?
              puts "====================================> NO MATCH FOUND FOR RESOURCE FACET #{facet}"
           else
              node[:size] = facet['size']
           end
        end
      end

      if search_type == :genres
        # use the name from data['genre']['facet'] to find a match in data from above
        # add size to the node data. Once complete, set data as the children of archives
        facet_data['genre']['facet'].each do |facet |
          node = find_genre( :name, facet['name'], json_resources)
          if node.nil?
            puts "====================================> NO MATCH FOUND FOR GENRE FACET #{facet}"
          else
            node[:size] = facet['size']
          end
        end
      end

      if search_type == :disciplines
        # use the name from data['discipline']['facet'] to find a match in data from above
        # add size to the node data. Once complete, set data as the children of archives
        facet_data['discipline']['facet'].each do |facet |
          node = find_discipline( :name, facet['name'], json_resources)
          if node.nil?
            puts "====================================> NO MATCH FOUND FOR DISCIPLINE FACET #{facet}"
          else
            node[:size] = facet['size']
          end
        end
      end

      if search_type == :formats
        # use the name from data['discipline']['facet'] to find a match in data from above
        # add size to the node data. Once complete, set data as the children of archives
        facet_data['format']['facet'].each do |facet |
          node = find_format( :name, facet['name'], json_resources)
          if node.nil?
            puts "====================================> NO MATCH FOUND FOR FORMAT FACET #{facet}"
          else
            node[:size] = facet['size']
          end
        end
      end

      json_resources.each do |jr|
        if jr[:size].nil?
          total = sum_children(jr[:children])
          puts "#{jr[:name]} summed size #{total}"
          jr[:size] = total
        end
      end

      return json_resources,arc_total
   end

   def self.get_resource_tree
      # get the data from the catalog. All catalog response are in XML
      xml_resp = RestClient.get "#{Settings.catalog_url}/archives.xml"

      # stuff xml into has and prune it to resource tree
      data = Hash.from_xml xml_resp
      data = data['resource_tree']

      # convert nasty XML into something useful by D3; first walk the nodes to
      # build the high level hierarchy
      json_resources = []
      data['nodes']['node'].each do | node |

         # if node is top-level, it will not have a parent attrib (grr)
         if node['parent'].nil?
            json_resources << { :name=>node['name'], :children=>[], :type=>"group"}
         else
            # recursively walk tree to find the parent resource
            parent = find_resource(:name, node['parent'], json_resources)
            parent[:children] << { :name=>node['name'], :children=>[], :type=>"group" }
         end
      end

      # Now walk the archives data and add as child to the main resource tree
      data['archives']['archive'].each do | archive |
         # recursively walk tree to find the parent resource
         parent = find_resource( :name, archive['parent'], json_resources )
         if !parent.nil?
            parent[:children]  << { :name=>archive['name'], :handle=>archive['handle'], :type=>"archive"}
         end
      end
      return json_resources
   end

   def self.get_genres
     # get the data from the catalog. All catalog response are in XML
     xml_resp = RestClient.get "#{Settings.catalog_url}/genres.xml"

     # stuff xml into has and prune it to resource tree
     data = Hash.from_xml xml_resp

     # convert nasty XML into something useful by D3; first walk the nodes to
     # build the high level hierarchy
     json_resources = []

     data['genres']['genre'].each do | node |
         json_resources << { :name=>node['name'].strip, :children=>[], :type=>"genre"}
     end
     return json_resources
   end

   def self.get_disciplines
     # get the data from the catalog. All catalog response are in XML
     xml_resp = RestClient.get "#{Settings.catalog_url}/disciplines.xml"

     # stuff xml into has and prune it to resource tree
     data = Hash.from_xml xml_resp

     # convert nasty XML into something useful by D3; first walk the nodes to
     # build the high level hierarchy
     json_resources = []

     data['disciplines']['discipline'].each do | node |
       json_resources << { :name=>node['name'].strip, :children=>[], :type=>"discipline"}
     end
     return json_resources
   end

     ## FIXME: formats.xml is not implemented in the catalog. Must use alternate facets query.
     def self.get_formats
       # get the data from the catalog. All catalog responses are in XML
      # xml_resp = RestClient.get "#{Settings.catalog_url}/formats.xml"

       # stuff xml into has and prune it to resource tree
      # data = Hash.from_xml xml_resp

       # convert nasty XML into something useful by D3; first walk the nodes to
       # build the high level hierarchy
       json_resources = []

      # data['formats']['formats'].each do | node |
      #   json_resources << { :name=>node['name'].strip, :children=>[], :type=>"format"}
      # end

       return json_resources
   end
end